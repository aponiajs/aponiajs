import {
  AponiaError,
  getCatchMetadata,
  tokenName,
  type AponiaInterceptor,
  type CanActivate,
  type ClassToken,
  type EnhancerMetadata,
  type ExceptionFilter,
  type LoggerService,
  type ModuleDefinition,
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
  readonly interceptors: readonly AponiaInterceptor[];
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
export interface InterceptorHalves {
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
  readonly halves: ReadonlyMap<ClassToken<unknown>, InterceptorHalves>;
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
const noInterceptorHalves: ReadonlyMap<ClassToken<unknown>, InterceptorHalves> = new Map();

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
    halves: noInterceptorHalves,
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
function halvesOf(instance: AponiaInterceptor): InterceptorHalves {
  return Object.freeze({
    before: typeof instance.interceptBefore === "function",
    after: typeof instance.interceptAfter === "function",
  });
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
  const guards = resolveOnce(
    metadata.guards,
    (guard) => container.resolveModuleProvider(module, guard) as CanActivate,
  );
  const interceptors = resolveOnce(
    metadata.interceptors,
    (interceptor) => container.resolveModuleProvider(module, interceptor) as AponiaInterceptor,
  );
  const filters = resolveOnce(metadata.filters, (filter) =>
    Object.freeze({
      instance: container.resolveModuleProvider(module, filter) as ExceptionFilter,
      catch: getCatchMetadata(filter),
    }),
  );

  const halves = new Map<ClassToken<unknown>, InterceptorHalves>();
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
      `Enhancer "${tokenName(token)}" was not resolved for module "${module.id}".`,
      { module: module.id, enhancer: tokenName(token) },
    );
  }

  return instance;
}
