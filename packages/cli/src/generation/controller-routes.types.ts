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
 * The validation slots a route decorator's schema can declare.
 *
 * Mirrors `routeSchemaSlots` in `@aponiajs/common`
 * (`packages/common/src/routing/route-schema.ts`). The CLI is independent of the
 * runtime packages, so the union is declared locally and must be kept in step
 * with that source by hand.
 */
export type AnalyzedRouteSchemaSlotName =
  | "body"
  | "cookie"
  | "headers"
  | "params"
  | "query"
  | "response";

/**
 * One slot of a route's validation schema.
 *
 * The expression is kept exactly as the decorator wrote it, because the runtime
 * hands a slot's value to the platform unchanged: a validation model class is
 * emitted by its class name, an inline `t.Object({ ... })` by its own text, and a
 * status-specific response map by the object literal that declares it. Nothing
 * here interprets a validator.
 *
 * A slot whose value the analysis cannot reproduce is reported rather than
 * dropped, so a consumer declines the route instead of emitting a schema the
 * application did not write.
 */
export interface AnalyzedRouteSchemaSlot {
  readonly slot: AnalyzedRouteSchemaSlotName;
  /** The slot's value exactly as the decorator wrote it. */
  readonly expression: string;
  /** Why the slot cannot be reproduced in generated source, or `undefined` when it can. */
  readonly unreadable: string | undefined;
}

/** The validation schema one route decorator declares. */
export interface AnalyzedRouteSchema {
  /** The slots the decorator declares, in the canonical slot order rather than in source order. */
  readonly slots: readonly AnalyzedRouteSchemaSlot[];
  /**
   * The first reason the whole schema cannot be reproduced — a reason of its
   * own, such as a spread or a computed slot name, or the reason any one slot
   * carries. An empty schema is readable and has none.
   */
  readonly unreadable: string | undefined;
}

/**
 * The request values a route handler parameter can bind to.
 *
 * Mirrors `RouteParameterKind` in `@aponiajs/common`
 * (`packages/common/src/routing/route-parameters.ts` and
 * `route-parameters.types.ts`). The CLI is independent of the runtime packages,
 * so the union is declared locally and must be kept in step with that source by
 * hand. Decorator names do not always match their kind: `@Param` binds
 * `"params"`, `@Context` binds `"context"`, `@Req` binds `"request"`, and
 * `@ResponseSettings` binds `"set"`.
 */
export type AnalyzedRouteParameterKind =
  | "body"
  | "cookie"
  | "context"
  | "custom"
  | "headers"
  | "params"
  | "query"
  | "request"
  | "set"
  | "status"
  | "store";

/**
 * The enhancer kinds a controller class or a route handler can declare.
 *
 * Mirrors `EnhancerMetadata` in `@aponiajs/common`
 * (`packages/common/src/enhancers/enhancer.types.ts`). The CLI is independent of
 * the runtime packages, so the union is declared locally and must be kept in
 * step with that source by hand.
 */
export type AnalyzedEnhancerKind = "filters" | "guards" | "interceptors";

/**
 * The enhancer class references one scope declares, or a route's joined scopes.
 *
 * Each entry is the name the declaring file knows the class by, exactly as the
 * decorator wrote it: a generated module has to import it from where that file
 * imported it, which is the same rule every copied expression follows.
 *
 * The order is the one the runtime runs the class in, and it is not the same
 * for every kind. `@UseGuards()` and `@UseInterceptors()` run outward-in, so the
 * controller's own declarations come first and the handler's follow;
 * `@UseFilters()` runs most-specific-first, so the handler's own declarations
 * come first and the controller's follow. `routing/route-compiler.ts`'s
 * `mergeEnhancerMetadata` joins the two scopes in exactly those orders, and a
 * generated route reaches the platform with the same list a decorated one
 * carries.
 *
 * A declaration the analysis cannot read is reported in `unreadable` rather than
 * dropped, so a consumer declines the route instead of emitting a route that is
 * quietly less guarded than the one the application wrote.
 */
export interface AnalyzedEnhancers {
  /** The guards this scope declares, in the order they run. */
  readonly guards: readonly string[];
  /** The interceptors this scope declares, in the order they run. */
  readonly interceptors: readonly string[];
  /** The filters this scope declares, in the order they run. */
  readonly filters: readonly string[];
  /** Why the declarations cannot be reproduced in generated source, or `undefined` when they can. */
  readonly unreadable: string | undefined;
}

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
   * Whether the handler's declared return type proves a synchronous return.
   *
   * The runtime reads this from emitted `design:returntype`: a handler is
   * Promise-capable unless that metadata names a constructor other than
   * `Promise`, `Object`, or `undefined`. A primitive annotation — `string`,
   * `number`, `boolean`, `bigint`, `symbol` — is the only source text that
   * proves which constructor the metadata will name, so it is the only shape
   * reported here. An annotation naming a class does not: it may also name an
   * interface or a type alias, both of which reach the runtime as `Object`.
   *
   * A consumer that declares a route instead of decorating one states this
   * fact, and must omit it whenever it is `false`, because a route that is
   * Promise-capable merely costs one settled `await` while a route that wrongly
   * claims to be synchronous exposes a raw Promise to the lifecycle.
   */
  readonly declaresSynchronousReturn: boolean;
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
  /**
   * The enhancers the route runs: the controller class's own declarations
   * joined with this handler's, in the order the runtime runs them.
   */
  readonly enhancers: AnalyzedEnhancers;
  /**
   * The validation schema the decorator declares, or `undefined` when it
   * declares none.
   *
   * The schema is reported per decorator, because a method may carry more than
   * one route decorator and each declares its own.
   */
  readonly schema: AnalyzedRouteSchema | undefined;
}

/** One `@Controller()` class and the routes it declares. */
export interface AnalyzedController {
  readonly className: string;
  /** The path exactly as the decorator wrote it, or `""` when it was omitted. */
  readonly path: string;
  /** The controller's routes in method declaration order. */
  readonly routes: readonly AnalyzedRoute[];
}
