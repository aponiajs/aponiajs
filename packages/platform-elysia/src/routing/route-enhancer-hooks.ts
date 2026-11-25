import type {
  ArgumentsHost,
  CanActivate,
  HttpArgumentsHost,
  Interceptor,
  LoggerService,
  RouteContext,
} from "@aponiajs/common";
import type { MountedRouteEnhancers, ResolvedFilter } from "../controllers/enhancer.resolver.ts";
import { isFilterMatch, reportThroughLogger } from "../exceptions/default-exception.filter.ts";
import type {
  CompiledElysiaRoute,
  ElysiaErrorHook,
} from "../interfaces/route-compiler.interface.ts";

/**
 * The guards one route runs: the application's own declaration first, then the
 * ones the route declares, each scope in the order it declared them.
 *
 * A route that declares no guard of its own runs the application's declaration
 * itself, so a route with no enhancers at all merges nothing and allocates
 * nothing.
 *
 * @internal
 */
export function routeGuards(
  mountedEnhancers: MountedRouteEnhancers,
  route: CompiledElysiaRoute,
): readonly CanActivate[] {
  const declared = mountedEnhancers.controller.forRoute(route.enhancers).guards;
  if (declared.length === 0) {
    return mountedEnhancers.global.guards;
  }

  return Object.freeze([...mountedEnhancers.global.guards, ...declared]);
}

/**
 * The interceptors one route runs, in the order their before halves run: the
 * application's own declaration first, then the ones the route declares, each
 * scope in the order it declared them.
 *
 * A route that declares no interceptor of its own runs the application's
 * declaration itself, so a route that declares no interceptor at all merges
 * nothing and allocates nothing.
 *
 * @internal
 */
export function routeInterceptors(
  mountedEnhancers: MountedRouteEnhancers,
  route: CompiledElysiaRoute,
): readonly Interceptor[] {
  const declared = mountedEnhancers.controller.forRoute(route.enhancers).interceptors;
  if (declared.length === 0) {
    return mountedEnhancers.global.interceptors;
  }

  return Object.freeze([...mountedEnhancers.global.interceptors, ...declared]);
}

/**
 * The `error` array one route mounts: the filters the route declares, then the
 * application's own, then the Problem Details mapping every route carries last.
 *
 * The order is the reverse of the guard order, because the first filter that
 * answers wins: a route's own filters are consulted before the application's,
 * so the most specific one decides, and the mapping at the end answers only
 * what every declared filter declined.
 *
 * `undefined` is what a mount with no boot states, and it is returned as such:
 * a mount that resolved nothing and has nothing to map with mounts no `error`
 * hook at all rather than an inert one.
 *
 * @internal
 */
export function routeExceptionHooks(
  mountedEnhancers: MountedRouteEnhancers,
  route: CompiledElysiaRoute,
): ElysiaErrorHook[] | undefined {
  const { defaultFilter, logger } = mountedEnhancers.exceptionHandling;
  const declared = mountedEnhancers.controller.forRoute(route.enhancers).filters;
  const filters = [...declared, ...mountedEnhancers.global.filters];
  if (filters.length === 0 && defaultFilter === undefined) {
    return undefined;
  }

  const hooks = filters.map((filter) => createFilterHook(filter, logger));
  if (defaultFilter !== undefined) {
    hooks.push(defaultFilter);
  }

  return hooks;
}

/**
 * One declared filter as a route's `error` array runs it.
 *
 * The wrapper is what makes a filter's own failure reach the entry behind it
 * rather than escape into a second failure: the exception is matched against
 * the types the filter declared, `catch` is called with the matched exception
 * and the host, its result is awaited, and a filter that throws or rejects is
 * reported on the system logger and declined. Reporting it keeps a broken
 * filter visible, and declining it is what lets the mapping the route carries
 * last still answer the request.
 *
 * Declining happens before the filter is called, so a filter that answers for a
 * narrower type than the one thrown is never constructed-for and never runs.
 *
 * @internal
 */
export function createFilterHook(
  filter: ResolvedFilter,
  logger: LoggerService | undefined,
): ElysiaErrorHook {
  return async (context) => {
    if (!isFilterMatch(filter, context.error)) {
      return undefined;
    }

    try {
      const answered = await filter.instance.catch(context.error, createArgumentsHost(context));
      // The documented contract is that `undefined` and `null` both decline, so
      // the next entry in the array answers. Elysia 1.4 read the two the same
      // way; Elysia 2 ends the error path on anything that is not `undefined`,
      // so a filter declining with `null` is translated rather than allowed to
      // answer an empty response in the mapping's place.
      return answered === null ? undefined : answered;
    } catch (failure) {
      reportThroughLogger(logger, failure, "ExceptionsHandler");
      return undefined;
    }
  };
}

/**
 * What a filter running for one request is given about the route it runs for.
 *
 * The object is built per request because it carries the request's own context,
 * and it is an `ArgumentsHost` rather than an `ExecutionContext`: a filter is
 * not asked which class or handler threw, and `common` deliberately does not
 * carry the per-transport dispatch Nest's host performs.
 *
 * @internal
 */
export function createArgumentsHost(context: RouteContext): ArgumentsHost {
  const httpHost: HttpArgumentsHost = Object.freeze({ getRequest: () => context });

  return Object.freeze({
    getContext: () => context,
    switchToHttp: () => httpHost,
    switchToRpc: () =>
      Object.freeze({
        getData: <T = unknown>(): T => (context as unknown as { readonly body?: T }).body as T,
        getContext: <T = unknown>(): T => context as unknown as T,
      }),
    switchToWs: () =>
      Object.freeze({
        getClient: <T = unknown>(): T => undefined as unknown as T,
        getData: <T = unknown>(): T => (context as unknown as { readonly body?: T }).body as T,
        getPattern: () => "",
      }),
    getType: () => "http" as const,
  });
}

/**
 * Class constructors pass a `typeof` check and then throw when called without
 * `new`, which would surface as a raw engine message on every request. The
 * class definition's own source is the reliable signal: a class is only ever
 * written as `class ...`, and minifiers keep that leading keyword.
 *
 * @internal
 */
export function isClassConstructor(handler: (...arguments_: unknown[]) => unknown): boolean {
  return /^class[\s{/]/.test(Function.prototype.toString.call(handler).trimStart());
}
