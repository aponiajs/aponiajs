import type { RequestMethod, RouteParameterMetadata, RouteSchema } from "@aponiajs/common";

/**
 * One route a controller declares, as data rather than as decorator metadata.
 *
 * This is the descriptor path's equivalent of `@Get("/path", { body })` plus its
 * parameter decorators. `defineElysiaControllerRoutes` compiles a list of these
 * through the same lowering a decorated controller uses, so a generated or
 * hand-written descriptor reaches the same version guard, the same duplicate
 * route check, the same startup log lines, and the same generated-invoker
 * lookup. Note in particular that a plan never registers itself on Elysia:
 * `routing/native-route.ts` stays the only module that calls the native route
 * API.
 *
 * Two facts the decorator path reads out of emitted metadata are stated here
 * instead, because a plan has no class to reflect on:
 *
 * - `takesContext` decides what a handler with no decorated parameter receives.
 *   Decorators answer it from `design:paramtypes` and the handler's arity;
 *   omitting it here means the handler receives nothing.
 * - `promiseCapable` decides whether the route awaits a returned Promise.
 *   Decorators answer it from `design:returntype`; omitting it here means
 *   Promise-capable, which costs at most one already-settled `await` and is the
 *   direction that cannot change what a lifecycle hook observes.
 */
export interface ElysiaRoutePlan {
  readonly method: RequestMethod;
  /** The route path, relative to the controller's own path. */
  readonly path: string;
  /** The handler's property key, which is also the key a generated invoker uses. */
  readonly propertyKey: string | symbol;
  /** The handler's decorated parameter bindings, in declaration order. */
  readonly parameters?: readonly RouteParameterMetadata[];
  /**
   * Whether a handler that declares no decorated parameter receives the whole
   * context. Ignored when `parameters` is non-empty, which binds the handler's
   * arguments directly.
   */
  readonly takesContext?: boolean;
  /** Whether the handler returns a Promise the route has to await. */
  readonly promiseCapable?: boolean;
  /** The route's validation schema, exactly as a route decorator accepts one. */
  readonly schema?: RouteSchema;
}
