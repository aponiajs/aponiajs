import type {
  RequestMethod,
  RouteContext,
  RouteParameterKind,
  RouteParameterMetadata,
  RouteSchema,
} from "@aponiajs/common";

/**
 * A route handler compiled outside the platform, already bound to its
 * controller instance.
 *
 * Elysia reads handler source statically, so an invoker must name every context
 * field it uses directly instead of forwarding the context to a generic helper.
 */
export type AponiaRouteInvoker = (context: RouteContext) => unknown;

/**
 * Builds the invokers of one controller once its instance exists, keyed by the
 * handler property key.
 *
 * The `instance` parameter is deliberately `never` so a factory declared for a
 * concrete controller type stays assignable without a cast.
 */
export type AponiaControllerInvokerFactory = (
  instance: never,
) => ReadonlyMap<string | symbol, AponiaRouteInvoker>;

/**
 * Immutable route information produced from decorator metadata before a
 * controller instance is mounted.
 *
 * @internal
 */
export interface CompiledElysiaRoute {
  readonly method: RequestMethod;
  readonly path: string;
  readonly propertyKey: string | symbol;
  readonly parameters: readonly RouteParameterMetadata[];
  readonly capabilities: readonly RouteParameterKind[];
  readonly schema: RouteSchema | undefined;
  readonly declaredParameterCount: number | undefined;
  readonly declaredReturnKind: "promise" | "synchronous" | "unknown";
}
