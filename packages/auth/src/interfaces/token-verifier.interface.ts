import type { AuthUser } from "./auth.interface.ts";

/** The one operation `AuthGuard` needs from whichever verifier the module registered. */
export interface AuthVerifier {
  verify(token: string): Promise<AuthUser>;
}
