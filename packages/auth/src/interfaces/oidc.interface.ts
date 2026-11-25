/** The discovery document fields the verifier reads. */
export interface OidcProviderMetadata {
  readonly issuer: string;
  readonly jwks_uri: string;
  readonly authorization_endpoint?: string;
  readonly token_endpoint?: string;
  readonly userinfo_endpoint?: string;
  readonly end_session_endpoint?: string;
  readonly [field: string]: unknown;
}

/** OpenID Connect discovery options. */
export interface OidcOptions {
  /** The issuer the discovery document must state and every token must carry. */
  readonly issuer: string;
  /** The audience a token must name, when the provider sets one. */
  readonly audience?: string;
  /** The accepted signing algorithms; defaults to `RS256`, `PS256`, and `ES256`. */
  readonly algorithms?: readonly string[];
  /** The discovery URL; defaults to `<issuer>/.well-known/openid-configuration`. */
  readonly discoveryUrl?: string;
  /** How long one discovery or key-set request may take; defaults to 5000 ms. */
  readonly timeoutMs?: number;
  /** Clock skew allowance in seconds; defaults to 30. */
  readonly clockTolerance?: number;
  /** @internal The fetch implementation; tests inject one. */
  readonly fetch?: typeof globalThis.fetch;
}

/** The validated OIDC options the service reads. */
export interface ResolvedOidcOptions {
  readonly issuer: string;
  readonly audience: string | undefined;
  readonly algorithms: readonly string[];
  readonly discoveryUrl: string;
  readonly timeoutMs: number;
  readonly clockTolerance: number;
  readonly fetch: typeof globalThis.fetch;
}
