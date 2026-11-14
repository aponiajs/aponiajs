/** Response-header policy for the security plugin. */
export interface SecurityHeadersOptions {
  /**
   * The `Content-Security-Policy` value. A `{nonce}` placeholder is replaced
   * with a per-request nonce; read it in a handler through `getCspNonce`.
   */
  readonly contentSecurityPolicy?: string | false;
  readonly frameOptions?: string | false;
  readonly referrerPolicy?: string | false;
  readonly strictTransportSecurity?: string | false;
  readonly contentTypeOptions?: string | false;
  readonly permissionsPolicy?: string | false;
  readonly crossOriginOpenerPolicy?: string | false;
  readonly crossOriginEmbedderPolicy?: string | false;
  readonly crossOriginResourcePolicy?: string | false;
}

/** Cookie and token policy for signed double-submit CSRF protection. */
export interface CsrfOptions {
  /** The HMAC secret; at least 32 characters. */
  readonly secret: string;
  /** The cookie name; defaults to `aponia.csrf`. */
  readonly cookieName?: string;
  /** The header name; defaults to `x-csrf-token`. */
  readonly headerName?: string;
  /** The cookie path; defaults to `/`. */
  readonly path?: string;
  /** The cookie lifetime in seconds; defaults to a session cookie. */
  readonly maxAge?: number;
  /** The cookie domain. */
  readonly domain?: string;
  /** The cookie `Secure` attribute; defaults to true. */
  readonly secure?: boolean;
  /** The cookie `SameSite` attribute; defaults to `lax`. */
  readonly sameSite?: "lax" | "strict" | "none";
  /** Path prefixes excluded from CSRF enforcement. */
  readonly exclude?: readonly string[];
  /** Methods that require a token; defaults to POST, PUT, PATCH, and DELETE. */
  readonly methods?: readonly string[];
}

/** Options the security module accepts. */
export interface SecurityModuleOptions {
  /** Header policy; `true` uses the secure defaults, `false` disables them. */
  readonly headers?: boolean | SecurityHeadersOptions;
  /** CSRF policy; omitted disables CSRF. */
  readonly csrf?: CsrfOptions;
  /** The plugin module identity; defaults to `security`. */
  readonly key?: string;
}
