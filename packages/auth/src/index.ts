/**
 * `@aponiajs/auth` — JWT authentication and role/permission authorization.
 *
 * The package provides a request-scoped `AuthService`, a JWT service, a bearer
 * guard, role and permission guards, and Bun-native password hashing. It mounts
 * no HTTP route and reads no environment variable; the application declares it.
 */
export { AuthModule } from "./auth.module.ts";
export {
  MODULE_OPTIONS_TOKEN,
  type AuthModuleExtras,
  type AuthModuleSyncOptions,
} from "./auth.module-definition.ts";
export { AuthGuard } from "./auth.guard.ts";
export { AuthService } from "./auth.service.ts";
export { CurrentSession, CurrentUser } from "./current-user.decorator.ts";
export { AUTH_TOKEN_OPTIONS, AUTH_USER, AUTH_VERIFIER } from "./auth.constants.ts";
export type { AuthVerifier } from "./interfaces/token-verifier.interface.ts";
export { JwtService } from "./jwt.service.ts";
export { OidcService } from "./oidc.service.ts";
export { PasswordService } from "./password/password-hasher.service.ts";
export { RefreshTokenService } from "./refresh-token.service.ts";
export { MemoryRefreshTokenStore } from "./memory-refresh-token.store.ts";
export { RevocationService } from "./revocation.service.ts";
export { MemoryRevocationStore } from "./memory-revocation.store.ts";
export { PermissionsGuard } from "./permissions.guard.ts";
export { Roles, Permissions, Public } from "./authorization.decorator.ts";
export { RolesGuard } from "@aponiajs/platform-core";
export type {
  AuthModuleOptions,
  AuthSession,
  AuthUser,
  AuthVerificationOptions,
  AuthTokenOptions,
  JwtOptions,
  JwtKey,
} from "./interfaces/auth.interface.ts";
export type { OidcOptions, OidcProviderMetadata } from "./interfaces/oidc.interface.ts";
export type { RefreshOptions, RevocationOptions } from "./interfaces/auth.interface.ts";
export type {
  IssuedRefreshToken,
  RefreshTokenRecord,
  RefreshTokenStore,
} from "./interfaces/refresh-token.interface.ts";
export type { RevocationStore } from "./interfaces/revocation.interface.ts";
