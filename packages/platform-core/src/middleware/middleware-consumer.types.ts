import type { AponiaMiddleware, ClassToken, RequestMethod, RouteTarget } from "@aponiajs/common";

/**
 * A resolved middleware registration mapping middleware instances to targets and exclusions.
 */
export interface ResolvedMiddlewareConfig {
  /** The middleware classes or instances to execute. */
  readonly middleware: readonly (ClassToken<AponiaMiddleware> | AponiaMiddleware)[];
  /** Route targets (paths, controllers, or descriptors) this middleware applies to. */
  readonly targets: readonly RouteTarget[];
  /** Excluded route paths or descriptors. */
  readonly excluded: readonly (
    | string
    | { readonly path: string; readonly method?: RequestMethod }
  )[];
}
