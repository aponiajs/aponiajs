import {
  AponiaError,
  getCatchMetadata,
  tokenName,
  type AponiaInterceptor,
  type CanActivate,
  type ClassToken,
  type EnhancerMetadata,
  type ExceptionFilter,
  type ModuleDefinition,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";

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
 * Every enhancer a controller declares, resolved once while that controller
 * mounts.
 *
 * Each distinct class is resolved exactly once, however many of the
 * controller's routes name it, and `forRoute` assembles one route's ordered
 * lists from those shared instances: routes carry different method-level
 * declarations, so their lists differ even though the instances do not.
 */
export interface ResolvedControllerEnhancers extends ResolvedEnhancers {
  /**
   * The enhancers one of this controller's routes runs, in the order that route
   * declared them. Assembling a list resolves nothing and constructs nothing.
   */
  forRoute(metadata: EnhancerMetadata): ResolvedEnhancers;
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
 * mount even before any hook consumes it.
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

  return Object.freeze({
    guards: Object.freeze([...guards.values()]),
    interceptors: Object.freeze([...interceptors.values()]),
    filters: Object.freeze([...filters.values()]),
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
