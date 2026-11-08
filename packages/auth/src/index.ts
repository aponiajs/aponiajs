/**
 * `@aponiajs/auth` — JWT authentication and role/permission authorization.
 *
 * The package provides a request-scoped `AuthService`, a JWT service, a bearer
 * guard, role and permission guards, and Bun-native password hashing. It mounts
 * no HTTP route and reads no environment variable; the application declares it.
 */
export { AuthModule } from "./module/auth-module.ts";
export { AuthGuard } from "./authentication/auth.guard.ts";
export { AuthService } from "./authentication/auth.service.ts";
export { AUTH_TOKEN_OPTIONS, AUTH_USER, AUTH_VERIFIER } from "./authentication/auth.constants.ts";
export type { AuthVerifier } from "./authentication/token-verifier.types.ts";
export { JwtService } from "./jwt/jwt.service.ts";
export { OidcService } from "./oidc/oidc.service.ts";
export { PasswordService } from "./password/password.service.ts";
export { RefreshTokenService } from "./refresh/refresh-token.service.ts";
export { MemoryRefreshTokenStore } from "./refresh/memory-refresh-token-store.ts";
export { RevocationService } from "./revocation/revocation.service.ts";
export { MemoryRevocationStore } from "./revocation/memory-revocation-store.ts";
export { PermissionsGuard } from "./authorization/permissions.guard.ts";
export { Roles, Permissions, Public } from "./authorization/authorization.decorators.ts";
export { RolesGuard } from "@aponiajs/platform-elysia";
export type {
  AuthModuleOptions,
  AuthUser,
  AuthVerificationOptions,
  AuthTokenOptions,
  JwtOptions,
  JwtKey,
} from "./module/auth.types.ts";
export type { OidcOptions, OidcProviderMetadata } from "./oidc/oidc.types.ts";
export type { RefreshOptions, RevocationOptions } from "./module/auth.types.ts";
export type {
  IssuedRefreshToken,
  RefreshTokenRecord,
  RefreshTokenStore,
} from "./refresh/refresh-token.types.ts";
export type { RevocationStore } from "./revocation/revocation.types.ts";
