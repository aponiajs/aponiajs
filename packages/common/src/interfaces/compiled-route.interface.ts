import type { DeprecationMetadata } from "../routing/deprecation.ts";
import type { EnhancerMetadata } from "./enhancer-decorators.interface.ts";
import type { PipeType } from "./pipe.interface.ts";
import type { RequestMethod } from "./decorators.interface.ts";
import type { ResponseHeaderValue } from "./response-metadata.interface.ts";
import type { ResponseSerializer } from "../routing/response-serializer.ts";
import type { RouteParameterMetadata } from "./route-parameters.interface.ts";
import type { RouteSchema } from "./route-schema.interface.ts";
import type { ViewRenderOptions } from "../routing/view.ts";

/**
 * One route a controller declares, lowered from decorator metadata into the
 * data a platform mounts.
 *
 * The lowering is runtime-neutral: it states what the class declared, never how
 * a runtime should run it. A platform turns this into its own native route.
 */
export interface CompiledRoute {
  /** The HTTP method the route answers. */
  readonly method: RequestMethod;
  /** The fully joined path, including the version prefix when the route declares one. */
  readonly path: string;
  /** The handler method carrying this route. */
  readonly propertyKey: string | symbol;
  /** The parameters the handler reads, in declaration order. */
  readonly parameters: readonly RouteParameterMetadata[];
  /** The route schema, or `undefined` for an unvalidated route. */
  readonly schema: RouteSchema | undefined;
  /** The parameter count TypeScript emitted, used by the whole-context fallback. */
  readonly declaredParameterCount: number | undefined;
  /** Controller pipes followed by the handler's own. */
  readonly pipes: readonly PipeType[];
  /** Guards and interceptors outward-in, filters most-specific-first. */
  readonly enhancers: EnhancerMetadata;
  /** The serializer the handler or its controller declared. */
  readonly serializer: ResponseSerializer | undefined;
  /** The URI version the route mounts under, when it declares one. */
  readonly version?: string;
  /** Whether the route answers as Server-Sent Events. */
  readonly sse?: true;
  /** The view the handler renders, when it declares one. */
  readonly view?: { readonly template: string; readonly options?: ViewRenderOptions };
  /** The headers the handler declares on every answer. */
  readonly responseHeaders?: Readonly<Record<string, ResponseHeaderValue>>;
  /** The status the handler declares for its answer. */
  readonly httpCode?: number;
  /** The deprecation policy the route answers with, when it declares one. */
  readonly deprecation?: DeprecationMetadata;
}
