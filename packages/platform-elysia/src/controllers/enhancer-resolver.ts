import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  AponiaError,
  getCatchMetadata,
  getTokenName,
  type ApplicationEnhancer,
  type ApplicationEnhancerBinding,
  type ArgumentsHost,
  type ExecutionContext,
  type Interceptor,
  type CanActivate,
  type ClassToken,
  type EnhancerMetadata,
  type ExceptionFilter,
  type LoggerService,
  type ModuleDefinition,
  type Token,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import type { ElysiaErrorHook } from "../routing/route-compiler.types.ts";

/**
 * One filter, resolved: the instance that answers and the exception types it
 * answers.
 *
 * `catch` is what `@Catch()` recorded on the filter class itself, read as
 * declared, so a class that declared none answers for anything.
 */
export interface ResolvedFilter {
  readonly instance: ExceptionFilter;
  readonly catch: readonly ClassToken<unknown>[];
}

/** The enhancers of one scope, resolved to the instances that run them. */
export interface ResolvedEnhancers {
  readonly guards: readonly CanActivate[];
  readonly interceptors: readonly Interceptor[];
  readonly filters: readonly ResolvedFilter[];
}

/**
 * Which halves of the interceptor lifecycle a resolved class implements.
 *
 * Both are stated rather than one, because the platform calls each with an
 * optional call — `interceptor.interceptBefore?.(…)` — so a class implementing
 * one half runs one half, and a reader that inferred the other from the class
 * existing would state a step the route never runs.
 *
 * @internal
 */
export interface InterceptorPhases {
  readonly before: boolean;
  readonly after: boolean;
}

/**
 * Every enhancer a controller declares, resolved once while that controller
 * mounts.
 *
 * Each distinct class is resolved exactly once, however many of the
 * controller's routes name it, and `forRoute` assembles one route's ordered
 * lists from those shared instances: routes carry different method-level
 * declarations, so their lists differ even though the instances do not.
 *
 * `halves` is the one fact the instances themselves own: which halves an
 * interceptor class implements is a property of the object the platform calls,
 * and a half declared as a class field is an own property no class token
 * carries. It is keyed by the class token because that is what a plan — and so
 * any reader of the mounted routes — names.
 */
export interface ResolvedControllerEnhancers extends ResolvedEnhancers {
  /**
   * The enhancers one of this controller's routes runs, in the order that route
   * declared them. Assembling a list resolves nothing and constructs nothing.
   */
  forRoute(metadata: EnhancerMetadata): ResolvedEnhancers;
  /**
   * The halves each resolved interceptor class implements, keyed by its token.
   * A class resolved at two scopes, or on two routes, is one entry.
   */
  readonly halves: ReadonlyMap<ClassToken<unknown>, InterceptorPhases>;
}

/**
 * What a route's own `error` array carries besides the filters the route
 * declares: the Problem Details mapping every route ends with, and the channel
 * a filter's own failure is reported on.
 *
 * Both belong to the boot rather than to any controller, so both are built once
 * and travel with the mount beside the global enhancers: a route's hooks are
 * built while it mounts, which makes bootstrap the only place a boot's logger
 * and its mapping exist. `undefined` is a statement, not an omission — it is
 * what a mount that resolves nothing mounts with, and it is why such a mount
 * gains no `error` hook at all.
 *
 * @internal
 */
export interface MountedExceptionHandling {
  /** The mapping behind every declared filter, built once per boot. */
  readonly defaultFilter: ElysiaErrorHook | undefined;
  /** The system logger the mapping and every failed filter report on. */
  readonly logger: LoggerService | undefined;
}

/**
 * Everything one controller's mount runs its routes through: the application's
 * own declaration, resolved once for the whole boot, and the resolution the
 * controller's own declarations were lowered into.
 *
 * The two resolutions are kept apart rather than joined into flat lists because
 * a kind's run order is decided where that kind is consumed: a guard runs the
 * application's declaration first, while the filters run the other way round
 * and need the two scopes separately to say so. Joining them here would settle
 * an order no one asked for yet.
 *
 * @internal
 */
export interface MountedRouteEnhancers {
  /** The application's own declarations, resolved through the root module. */
  readonly global: ResolvedEnhancers;
  /** The declarations of the controller this mount belongs to. */
  readonly controller: ResolvedControllerEnhancers;
  /** What this mount's routes carry in their own `error` arrays. */
  readonly exceptionHandling: MountedExceptionHandling;
}

/** The enhancers that run nothing, shared because a resolution is never mutated. */
const noResolvedEnhancers: ResolvedEnhancers = Object.freeze({
  guards: Object.freeze([]),
  interceptors: Object.freeze([]),
  filters: Object.freeze([]),
});

/**
 * The halves of no class, shared for the same reason the empty lists are.
 *
 * It is stated rather than frozen for the one reason a `Map` cannot be: the
 * shared instance is empty and typed `ReadonlyMap`, so this package's own
 * callers cannot write into it, and nothing in this workspace reads it — the
 * halves a record publishes are the boot's own collection, which it copies, and
 * a mount that resolved nothing has none to publish.
 */
const noInterceptorPhases: ReadonlyMap<ClassToken<unknown>, InterceptorPhases> = new Map();

/**
 * The enhancers a mount that resolves nothing runs: the one a controller
 * definition's own `buildPlugin` makes.
 *
 * That path builds an Elysia plugin outside a boot, so it has no container to
 * resolve against, no application whose declaration it could merge, and no
 * system logger to report an unhandled failure on. Its routes mount with the
 * validators their schemas declare and no enhancer hooks at all. Bootstrap
 * never passes this value: every mount it makes carries a real resolution.
 *
 * @internal
 */
export const unmountedRouteEnhancers: MountedRouteEnhancers = Object.freeze({
  global: noResolvedEnhancers,
  controller: Object.freeze({
    ...noResolvedEnhancers,
    forRoute: () => noResolvedEnhancers,
    halves: noInterceptorPhases,
  }),
  exceptionHandling: Object.freeze({
    defaultFilter: undefined,
    logger: undefined,
  }),
});

/**
 * Whether one interceptor **instance** implements one half.
 *
 * The instance, not the class's `prototype`: the platform calls
 * `interceptor.interceptBefore?.(…)` on the instance, so a half written as a
 * class field is an own property the prototype never carries. A reader that
 * asks the prototype misses exactly that shape.
 */
function halvesOf(instance: Interceptor): InterceptorPhases {
  return Object.freeze({
    before: typeof instance.interceptBefore === "function",
    after: typeof instance.interceptAfter === "function",
  });
}

/**
 * The enhancers an application declares through the `APP_*` tokens.
 *
 * Each token carries one enhancer or a list of them, in run order. A class is
 * resolved through the root module, so an unreachable class fails the boot with
 * the same `MISSING_PROVIDER` an options-level enhancer raises; an instance is
 * used as given. The result merges after the options-level declaration and
 * before every controller's own, which is the order the platform runs.
 *
 * `halves` keys each resolved interceptor by the class it came from: the token
 * for a class entry, and the instance's own constructor for an instance entry.
 *
 * @internal
 */
export interface ResolvedApplicationEnhancers extends ResolvedEnhancers {
  readonly halves: ReadonlyMap<ClassToken<unknown>, InterceptorPhases>;
}

/**
 * Resolves `APP_GUARD`, `APP_INTERCEPTOR`, and `APP_FILTER` from the root
 * module.
 *
 * A token no module provides resolves to nothing, which is the ordinary shape
 * of an application that declares no application-wide enhancer. A token that is
 * provided carries the enhancer or the list; a value that is neither fails with
 * `INVALID_PROVIDER` naming the token.
 *
 * @param container - The booted container whose root module declares the tokens.
 * @returns The resolved enhancers, in declaration order.
 *
 * @internal
 */
export function resolveApplicationEnhancers(
  container: AponiaContainer,
): ResolvedApplicationEnhancers {
  const guards = readEnhancerBinding<CanActivate>(container, APP_GUARD).map((entry) =>
    typeof entry === "function"
      ? resolveGuard(container, container.graph.root, entry as ClassToken<unknown>)
      : (entry as CanActivate),
  );

  const halves = new Map<ClassToken<unknown>, InterceptorPhases>();
  const interceptors = readEnhancerBinding<Interceptor>(container, APP_INTERCEPTOR).map((entry) => {
    const instance =
      typeof entry === "function"
        ? resolveInterceptor(container, container.graph.root, entry as ClassToken<unknown>)
        : (entry as Interceptor);
    const classToken =
      typeof entry === "function"
        ? (entry as ClassToken<unknown>)
        : ((entry as object).constructor as ClassToken<unknown>);
    halves.set(classToken, halvesOf(instance));
    return instance;
  });

  const filters = readEnhancerBinding<ExceptionFilter>(container, APP_FILTER).map((entry) => {
    const instance =
      typeof entry === "function"
        ? resolveFilter(container, container.graph.root, entry as ClassToken<unknown>).instance
        : (entry as ExceptionFilter);
    const caught = getCatchMetadata(
      typeof entry === "function"
        ? (entry as ClassToken<unknown>)
        : ((entry as object).constructor as ClassToken<unknown>),
    );
    return Object.freeze({ instance, catch: caught });
  });

  return Object.freeze({
    guards: Object.freeze(guards),
    interceptors: Object.freeze(interceptors),
    filters: Object.freeze(filters),
    halves,
  });
}

/**
 * Merges two resolved enhancer lists, the first running first.
 *
 * A class declared at both scopes resolves to one instance, so deduplicating by
 * identity is what keeps it from running twice.
 *
 * @internal
 */
export function mergeResolvedEnhancers(
  primary: ResolvedEnhancers,
  extra: ResolvedEnhancers,
): ResolvedEnhancers {
  return Object.freeze({
    guards: Object.freeze([...new Set([...primary.guards, ...extra.guards])]),
    interceptors: Object.freeze([...new Set([...primary.interceptors, ...extra.interceptors])]),
    filters: Object.freeze([
      ...new Map(
        [...primary.filters, ...extra.filters].map((filter) => [filter.instance, filter]),
      ).values(),
    ]),
  });
}

function readEnhancerBinding<T>(
  container: AponiaContainer,
  token: Token<ApplicationEnhancerBinding<T>>,
): readonly ApplicationEnhancer<T>[] {
  const module = container.graph.root;
  try {
    container.graph.locate(module, token);
  } catch (error) {
    if (error instanceof AponiaError && error.code === "MISSING_PROVIDER") {
      return [];
    }
    throw error;
  }

  const value = container.resolveModuleProvider(module, token) as
    | ApplicationEnhancerBinding<T>
    | undefined;
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value)
    ? Object.freeze([...value] as readonly ApplicationEnhancer<T>[])
    : [value as ApplicationEnhancer<T>];
}

/** Whether a resolution failed only because no request was active. */
function isMissingRequestContext(error: unknown): boolean {
  return error instanceof AponiaError && error.code === "MISSING_REQUEST_CONTEXT";
}

/**
 * Resolves one guard, deferring a request-scoped one to the request it runs for.
 *
 * A guard that depends on request state cannot exist while the route mounts, so
 * the mount keeps a forwarder that resolves the instance inside the hook the
 * request runs. The forwarder is still a `CanActivate`, so every consumer —
 * including the compiled fast path's reader — sees the same shape.
 */
function resolveGuard(
  container: AponiaContainer,
  module: ModuleDefinition,
  token: ClassToken<unknown>,
): CanActivate {
  try {
    return container.resolveModuleProvider(module, token) as CanActivate;
  } catch (error) {
    if (!isMissingRequestContext(error)) {
      throw error;
    }
    return Object.freeze({
      canActivate: (context: ExecutionContext) =>
        (container.resolveModuleProvider(module, token) as CanActivate).canActivate(context),
    });
  }
}

/**
 * Resolves one interceptor, deferring a request-scoped one to its request.
 *
 * The forwarded halves are the ones the class declares as methods. A half
 * declared as a class field exists only on an instance, and no instance exists
 * while the route mounts; a request-scoped interceptor therefore states its
 * halves as methods.
 */
function resolveInterceptor(
  container: AponiaContainer,
  module: ModuleDefinition,
  token: ClassToken<unknown>,
): Interceptor {
  try {
    return container.resolveModuleProvider(module, token) as Interceptor;
  } catch (error) {
    if (!isMissingRequestContext(error)) {
      throw error;
    }

    const prototype = (token as unknown as { readonly prototype?: Record<string, unknown> })
      .prototype;
    const resolve = (): Interceptor =>
      container.resolveModuleProvider(module, token) as Interceptor;

    return Object.freeze({
      ...(typeof prototype?.interceptBefore === "function"
        ? {
            interceptBefore: (context: ExecutionContext) => resolve().interceptBefore?.(context),
          }
        : {}),
      ...(typeof prototype?.interceptAfter === "function"
        ? {
            interceptAfter: (context: ExecutionContext, response: unknown) =>
              resolve().interceptAfter?.(context, response),
          }
        : {}),
    }) as Interceptor;
  }
}

/** Resolves one filter, deferring a request-scoped one to its request. */
function resolveFilter(
  container: AponiaContainer,
  module: ModuleDefinition,
  token: ClassToken<unknown>,
): ResolvedFilter {
  try {
    return Object.freeze({
      instance: container.resolveModuleProvider(module, token) as ExceptionFilter,
      catch: getCatchMetadata(token),
    });
  } catch (error) {
    if (!isMissingRequestContext(error)) {
      throw error;
    }

    const resolve = (): ExceptionFilter =>
      container.resolveModuleProvider(module, token) as ExceptionFilter;

    return Object.freeze({
      instance: Object.freeze({
        catch: (exception: unknown, host: ArgumentsHost) => resolve().catch(exception, host),
      }) as ExceptionFilter,
      catch: getCatchMetadata(token),
    });
  }
}

/**
 * Resolves every enhancer a controller declares, once per distinct class.
 *
 * Resolution goes through `resolveModuleProvider`, the same function the
 * container resolves every other dependency through, so an enhancer is subject
 * to the module graph's visibility rules: an undeclared or unreachable class
 * raises the same `MISSING_PROVIDER` a missing dependency does.
 *
 * Every class is resolved while its declaration is stated rather than while a
 * route asks for its lists, so a declaration that cannot resolve fails the
 * mount even before any hook consumes it. That is also the only moment the
 * pairing between a class token and the instance it resolved to is in hand, so
 * the halves are read here, from the instances, rather than left to a reader of
 * the tokens.
 */
export function resolveEnhancers(
  container: AponiaContainer,
  module: ModuleDefinition,
  metadata: EnhancerMetadata,
): ResolvedControllerEnhancers {
  const guards = resolveOnce(metadata.guards, (guard) => resolveGuard(container, module, guard));
  const interceptors = resolveOnce(metadata.interceptors, (interceptor) =>
    resolveInterceptor(container, module, interceptor),
  );
  const filters = resolveOnce(metadata.filters, (filter) =>
    resolveFilter(container, module, filter),
  );

  const halves = new Map<ClassToken<unknown>, InterceptorPhases>();
  for (const [token, interceptor] of interceptors) {
    halves.set(token, halvesOf(interceptor));
  }

  return Object.freeze({
    guards: Object.freeze([...guards.values()]),
    interceptors: Object.freeze([...interceptors.values()]),
    filters: Object.freeze([...filters.values()]),
    halves,
    forRoute: (route: EnhancerMetadata): ResolvedEnhancers =>
      Object.freeze({
        guards: Object.freeze(route.guards.map((guard) => resolvedInstance(guards, guard, module))),
        interceptors: Object.freeze(
          route.interceptors.map((interceptor) =>
            resolvedInstance(interceptors, interceptor, module),
          ),
        ),
        filters: Object.freeze(
          route.filters.map((filter) => resolvedInstance(filters, filter, module)),
        ),
      }),
  });
}

/**
 * Every enhancer declaration a controller's compiled routes carry, in route
 * order.
 *
 * A decorated controller's compiled routes already carry its class-level
 * declarations joined with each handler's own, so concatenating them states
 * everything the controller declares. A class declared by two of its routes
 * appears once per route, which is deliberate: resolution is cached by class, so
 * a repeat costs nothing, and every route keeps the run order it declared.
 */
export function collectEnhancerDeclarations(
  routes: readonly { readonly enhancers: EnhancerMetadata }[],
): EnhancerMetadata {
  return Object.freeze({
    guards: Object.freeze(routes.flatMap((route) => route.enhancers.guards)),
    interceptors: Object.freeze(routes.flatMap((route) => route.enhancers.interceptors)),
    filters: Object.freeze(routes.flatMap((route) => route.enhancers.filters)),
  });
}

/**
 * Resolves each distinct class once, keeping first-declaration order. A class
 * a controller declares at two scopes, or on two routes, is one provider and
 * one instance.
 */
function resolveOnce<TInstance>(
  tokens: readonly ClassToken<unknown>[],
  resolve: (token: ClassToken<unknown>) => TInstance,
): Map<ClassToken<unknown>, TInstance> {
  const resolved = new Map<ClassToken<unknown>, TInstance>();
  for (const token of tokens) {
    if (!resolved.has(token)) {
      resolved.set(token, resolve(token));
    }
  }

  return resolved;
}

/**
 * A route's declaration can only name classes its controller resolved: a global
 * enhancer is resolved separately and merged by the mount. A class that reached
 * this point anyway raises `MISSING_PROVIDER` rather than contributing an
 * undefined instance to a route's hooks.
 */
function resolvedInstance<TInstance>(
  resolved: ReadonlyMap<ClassToken<unknown>, TInstance>,
  token: ClassToken<unknown>,
  module: ModuleDefinition,
): TInstance {
  const instance = resolved.get(token);
  if (instance === undefined) {
    throw new AponiaError(
      "MISSING_PROVIDER",
      `Enhancer "${getTokenName(token)}" was not resolved for module "${module.id}".`,
      { module: module.id, enhancer: getTokenName(token) },
    );
  }

  return instance;
}
