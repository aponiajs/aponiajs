/** How a cross-origin request is answered. */
export interface CorsOptions {
  /** The origins allowed: `*`, one origin, several, or a predicate. */
  readonly origin?: string | readonly string[] | ((origin: string) => string | undefined);
  /** The methods a preflight may ask for. */
  readonly methods?: readonly string[];
  /** The request headers a preflight may ask for; defaults to the asked ones. */
  readonly allowedHeaders?: readonly string[];
  /** The response headers a browser may read. */
  readonly exposedHeaders?: readonly string[];
  /** Whether cookies and authorization may cross origins. */
  readonly credentials?: boolean;
  /** How long a browser may cache the preflight, in seconds. */
  readonly maxAge?: number;
}

/** The extra headers a response carries, with `true` selecting the defaults. */
export interface SecurityHeadersOptions {
  readonly contentSecurityPolicy?: string | false;
  readonly strictTransportSecurity?: string | false;
  readonly xFrameOptions?: string | false;
  readonly referrerPolicy?: string | false;
  readonly xContentTypeOptions?: boolean;
  readonly crossOriginOpenerPolicy?: string | false;
  readonly crossOriginResourcePolicy?: string | false;
  readonly permissionsPolicy?: string | false;
}

/** How an entity tag is generated. */
export interface EtagOptions {
  /** Whether the tag is weak; defaults to `true`. */
  readonly weak?: boolean;
}

/** How a response body is compressed. */
export interface CompressionOptions {
  /** Whether compression is enabled; defaults to `true`. */
  readonly enabled?: boolean;
  /** The smallest body compressed, in bytes; defaults to 1024. */
  readonly threshold?: number;
}

/** The response policies an application states once. */
export interface HttpPolicyOptions {
  /** Cross-origin policy; `true` allows every origin. */
  readonly cors?: CorsOptions | boolean;
  /** Security headers; `true` selects the framework defaults. */
  readonly securityHeaders?: SecurityHeadersOptions | boolean;
  /** Entity tags and `304` answers; `true` emits a weak tag. */
  readonly etag?: EtagOptions | boolean;
  /** Response compression; `true` selects the defaults. */
  readonly compression?: CompressionOptions | boolean;
}

/** The policies a boot resolved, or `undefined` when it states none. */
export interface ResolvedHttpPolicies {
  readonly cors: ResolvedCors | undefined;
  readonly securityHeaders: readonly (readonly [string, string])[] | undefined;
  readonly etag: EtagOptions | undefined;
  readonly compression: CompressionOptions | undefined;
}

/** A validated cross-origin policy. */
export interface ResolvedCors {
  readonly origin: string | readonly string[] | ((origin: string) => string | undefined);
  readonly methods: readonly string[];
  readonly allowedHeaders: readonly string[] | undefined;
  readonly exposedHeaders: readonly string[];
  readonly credentials: boolean;
  readonly maxAge: number | undefined;
}

/**
 * One neutral request/response transform a package contributes.
 *
 * A package states the policy once, in `forRoot`, and every platform runs it
 * through the shared pipeline. `onRequest` answers a request before routing —
 * a CORS preflight, an idempotency replay, a rate-limit refusal — and
 * `onResponse` transforms the final response.
 */
export interface HttpPolicy {
  /** The name a diagnostic and a duplicate check read. */
  readonly name: string;
  /** Answers the request before routing, or declines it. */
  onRequest?(request: Request): Response | undefined | Promise<Response | undefined>;
  /** Transforms the final response. */
  onResponse?(request: Request, response: Response): Response | Promise<Response>;
}
