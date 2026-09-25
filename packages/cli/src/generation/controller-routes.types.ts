/**
 * The HTTP methods an Aponia route decorator can declare.
 *
 * Mirrors `RequestMethod` in `@aponiajs/common`
 * (`packages/common/src/decorators/decorators.types.ts`). The CLI is independent
 * of the runtime packages, so the union is declared locally and must be kept in
 * step with that source by hand.
 */
export type AnalyzedRequestMethod =
  | "DELETE"
  | "GET"
  | "HEAD"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PUT";

/**
 * The request values a route handler parameter can bind to.
 *
 * Mirrors `RouteParameterKind` in `@aponiajs/common`
 * (`packages/common/src/routing/route-parameters.ts` and
 * `route-parameters.types.ts`). The CLI is independent of the runtime packages,
 * so the union is declared locally and must be kept in step with that source by
 * hand. Decorator names do not always match their kind: `@Param` binds
 * `"params"`, `@Ctx` binds `"context"`, `@Req` binds `"request"`, and
 * `@Set`/`@Res` both bind `"set"`.
 */
export type AnalyzedRouteParameterKind =
  | "body"
  | "cookie"
  | "context"
  | "headers"
  | "params"
  | "query"
  | "request"
  | "set"
  | "status"
  | "store";

/**
 * One route handler parameter that a parameter decorator binds.
 *
 * Only decorated parameters appear. The runtime's fallback for undecorated
 * parameters — one declared parameter receives the whole context — is applied
 * while mounting routes, not by source analysis.
 */
export interface AnalyzedRouteParameter {
  /** Position of the parameter in the handler's declaration. */
  readonly index: number;
  /** The context value the decorator binds. */
  readonly kind: AnalyzedRouteParameterKind;
  /** The named property of that value, or `undefined` when the whole value is bound. */
  readonly property: string | undefined;
}

/** One HTTP route a controller method declares. */
export interface AnalyzedRoute {
  readonly method: AnalyzedRequestMethod;
  /** The path exactly as the decorator wrote it, or `""` when it was omitted. */
  readonly path: string;
  /** The name of the method that handles the route. */
  readonly methodName: string;
  /** Whether the handler is declared `async` or annotated with `Promise<...>`. */
  readonly promiseCapable: boolean;
  /**
   * Whether the handler declares at least one parameter.
   *
   * The runtime gives a handler that has no decorated parameter but declares at
   * least one the whole request context. That decision is made while mounting
   * routes, so the analysis reports the fact and lets its consumer apply the
   * rule rather than guessing it here.
   */
  readonly declaresParameters: boolean;
  /**
   * Whether the handler's body reads the legacy `arguments` object.
   *
   * A handler that declares no parameter but reaches for `arguments` still
   * receives the context, so a consumer that cannot account for it must decline
   * rather than assume the handler takes nothing.
   */
  readonly usesArgumentsObject: boolean;
  /** The handler's decorated parameters, ordered by parameter index. */
  readonly parameters: readonly AnalyzedRouteParameter[];
}

/** One `@Controller()` class and the routes it declares. */
export interface AnalyzedController {
  readonly className: string;
  /** The path exactly as the decorator wrote it, or `""` when it was omitted. */
  readonly path: string;
  /** The controller's routes in method declaration order. */
  readonly routes: readonly AnalyzedRoute[];
}
