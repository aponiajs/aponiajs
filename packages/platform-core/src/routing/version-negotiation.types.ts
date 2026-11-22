/** The strategy an application negotiates its route version with. */
export interface AponiaVersioningOptions {
  /** The strategy; defaults to `uri`. */
  readonly type?: "uri" | "header" | "media-type";
  /** The request header for `header`; defaults to `x-api-version`. */
  readonly header?: string;
  /** The `Accept` parameter for `media-type`; defaults to `version`. */
  readonly parameter?: string;
  /** The version used when a request states none. */
  readonly defaultVersion?: string;
}

/**
 * The route facts version negotiation needs.
 *
 * A compiled route satisfies this structurally, so a platform passes its own
 * route list without constructing a second descriptor.
 */
export interface VersionNegotiationRoute {
  /** The HTTP method the route answers. */
  readonly method: string;
  /** The lowered path, including the version mount when the route declares one. */
  readonly path: string;
  /** The URI version the route mounts under, when it declares one. */
  readonly version?: string | undefined;
}

/**
 * Reads one request and states what the boot should do with it.
 *
 * `undefined` leaves the request alone, a `Request` is the rewritten request the
 * router should answer, and a `Response` is the negotiation refusal.
 */
export type VersionNegotiator = (request: Request) => Request | Response | undefined;
