import type { AuthUser } from "../module/auth.types.ts";

/** The one operation `AuthGuard` needs from whichever verifier the module registered. */
export interface AuthVerifier {
  verify(token: string): Promise<AuthUser>;
}
