import type {
  RequestMethod,
  RouteParameterKind,
  RouteParameterMetadata,
  RouteSchema,
} from "@aponiajs/common";

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
