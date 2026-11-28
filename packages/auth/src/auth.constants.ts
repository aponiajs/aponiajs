import { createToken } from "@aponiajs/common";
import type { AuthVerifier } from "./interfaces/token-verifier.interface.ts";
import type { AuthUser, ResolvedAuthTokenOptions } from "./interfaces/auth.interface.ts";

/** The request-context token the authenticated user is stored under. */
export const AUTH_USER = createToken<AuthUser>("aponia.auth.user");

/** The verifier `AuthGuard` uses; `JwtService` or `OidcService` behind one token. */
export const AUTH_VERIFIER = createToken<AuthVerifier>("aponia.auth.verifier");

/** The header/cookie policy `AuthGuard` reads. */
export const AUTH_TOKEN_OPTIONS = createToken<ResolvedAuthTokenOptions>(
  "aponia.auth.token-options",
);
