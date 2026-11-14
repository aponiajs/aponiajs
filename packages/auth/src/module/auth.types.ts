import type { OidcOptions } from "../oidc/oidc.types.ts";
import type { RefreshTokenStore } from "../refresh/refresh-token.types.ts";
import type { RevocationStore } from "../revocation/revocation.types.ts";

/** Claims an authenticated user carries. */
export interface AuthUser {
  readonly id?: string | number;
  readonly roles?: readonly string[];
  readonly permissions?: readonly string[];
  readonly [claim: string]: unknown;
}

/** JWT verification and signing options. */
export interface JwtOptions {
  /** The HMAC secret; at least 32 characters. */
  readonly secret: string;
  /** The required issuer. */
  readonly issuer?: string;
  /** The required audience. */
  readonly audience?: string;
  /** The accepted algorithms; defaults to HS256. */
  readonly algorithms?: readonly string[];
  /** The lifetime `sign()` uses; defaults to one hour. */
  readonly expiresIn?: string | number;
  /**
   * Additional signing keys, so a secret can be rotated without invalidating
   * the tokens the previous one signed.
   *
   * `sign()` uses the active key and writes its `kid`; `verify()` accepts a
   * token signed by any key in this list, and by `secret` when the token states
   * no `kid`. A token naming a `kid` this list does not contain is refused.
   */
  readonly keys?: readonly JwtKey[];
  /** The `kid` `sign()` uses; defaults to the first entry of `keys`. */
  readonly activeKid?: string;
}

/** One signing key a rotation list carries. */
export interface JwtKey {
  /** The identifier the token header names. */
  readonly kid: string;
  /** The HMAC secret; at least 32 characters. */
  readonly secret: string;
}

/** The one token verifier a registration states: a local secret or an OIDC issuer. */
export type AuthVerificationOptions =
  | { readonly jwt: JwtOptions; readonly oidc?: undefined }
  | { readonly oidc: OidcOptions; readonly jwt?: undefined };

/** Options `AuthModule.register` accepts. */
export type AuthModuleOptions = AuthVerificationOptions & {
  readonly token?: AuthTokenOptions;
  readonly refresh?: RefreshOptions;
  readonly revocation?: RevocationOptions;
};

/** Where a request may carry its access token. */
export interface AuthTokenOptions {
  /**
   * A cookie carrying the JWT, for an application that keeps it out of
   * JavaScript. The header still wins when both are present.
   *
   * A cookie transport needs CSRF protection on unsafe requests; pair it with
   * `@aponiajs/security`'s CSRF policy rather than relying on `SameSite` alone.
   */
  readonly cookieName?: string;
  /** The authorization scheme; defaults to `Bearer`. */
  readonly scheme?: string;
}

/** The validated token transport the guard reads. */
export interface ResolvedAuthTokenOptions {
  readonly cookieName: string | undefined;
  readonly scheme: string;
}

/** Refresh-token issuance options. */
export interface RefreshOptions {
  readonly ttlMs?: number;
  /**
   * The store to keep refresh tokens in.
   *
   * Defaults to a bounded process-local store. An application that runs more
   * than one instance passes a store they share, so a token issued by one
   * process rotates on another.
   */
  readonly store?: RefreshTokenStore;
  /** The entry cap of the default store; ignored when `store` is supplied. */
  readonly maxTokens?: number;
  /** The clock the default store and the service read. */
  readonly now?: () => number;
}

/** Revocation-store options. */
export interface RevocationOptions {
  /**
   * The set of revoked access tokens.
   *
   * Defaults to a bounded process-local set. A multi-instance deployment
   * passes a shared set, so a token revoked by one process is refused by all.
   */
  readonly store?: RevocationStore;
  /** The entry cap of the default set; ignored when `store` is supplied. */
  readonly maxEntries?: number;
  /** The clock the default set reads. */
  readonly now?: () => number;
}

/** The validated JWT options the service reads. */
export interface ResolvedJwtOptions {
  readonly secret: string;
  readonly issuer: string | undefined;
  readonly audience: string | undefined;
  readonly algorithms: readonly string[];
  readonly expiresIn: string | number;
  readonly keys?: readonly JwtKey[] | undefined;
  readonly activeKid?: string | undefined;
}
