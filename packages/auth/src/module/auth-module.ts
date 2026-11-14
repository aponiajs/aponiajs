import {
  AponiaError,
  Module,
  Reflector,
  provideClass,
  provideValue,
  type DynamicModule,
  type Provider,
  type Token,
} from "@aponiajs/common";
import { RequestContextModule, RequestContextService, RolesGuard } from "@aponiajs/platform-elysia";
import { AUTH_TOKEN_OPTIONS, AUTH_VERIFIER } from "../authentication/auth.constants.ts";
import { AuthService } from "../authentication/auth.service.ts";
import { AuthGuard } from "../authentication/auth.guard.ts";
import type { AuthVerifier } from "../authentication/token-verifier.types.ts";
import { PermissionsGuard } from "../authorization/permissions.guard.ts";
import { JwtService } from "../jwt/jwt.service.ts";
import { OidcService } from "../oidc/oidc.service.ts";
import { PasswordService } from "../password/password.service.ts";
import { MemoryRefreshTokenStore } from "../refresh/memory-refresh-token-store.ts";
import { RefreshTokenService } from "../refresh/refresh-token.service.ts";
import { MemoryRevocationStore } from "../revocation/memory-revocation-store.ts";
import { RevocationService } from "../revocation/revocation.service.ts";
import type { RefreshTokenStore } from "../refresh/refresh-token.types.ts";
import type { RevocationStore } from "../revocation/revocation.types.ts";
import type {
  AuthModuleOptions,
  JwtOptions,
  ResolvedAuthTokenOptions,
  ResolvedJwtOptions,
} from "./auth.types.ts";

/** Provides JWT authentication, authorization guards, and password hashing. */
@Module({})
export class AuthModule {
  /** Builds one authentication module. */
  static register(options: AuthModuleOptions): DynamicModule {
    const verification = resolveVerification(options);
    const tokenOptions = resolveTokenOptions(options.token);
    const password = new PasswordService();
    const refreshStore =
      options.refresh?.store === undefined
        ? new MemoryRefreshTokenStore({
            maxTokens: options.refresh?.maxTokens,
            now: options.refresh?.now,
          })
        : options.refresh.store;
    assertRefreshStore(refreshStore);
    const revocationStore =
      options.revocation?.store === undefined
        ? new MemoryRevocationStore(options.revocation)
        : options.revocation.store;
    assertRevocationStore(revocationStore);
    const refresh = new RefreshTokenService(refreshStore, options.refresh);
    const revocation = new RevocationService(revocationStore);

    return Object.freeze({
      module: AuthModule,
      id: "AuthModule",
      instanceId: Symbol("AuthModule"),
      imports: Object.freeze([RequestContextModule.forRoot()]),
      controllers: Object.freeze([]),
      providers: Object.freeze([
        ...verification.providers,
        provideValue(AUTH_VERIFIER, verification.verifier),
        provideValue(AUTH_TOKEN_OPTIONS, tokenOptions),
        provideClass(AuthService, [RequestContextService]),
        provideValue(PasswordService, password),
        provideValue(RefreshTokenService, refresh),
        provideValue(RevocationService, revocation),
        provideClass(Reflector, []),
        provideClass(AuthGuard, [
          AUTH_VERIFIER,
          AUTH_TOKEN_OPTIONS,
          AuthService,
          Reflector,
          RevocationService,
        ]),
        provideClass(RolesGuard, [Reflector]),
        provideClass(PermissionsGuard, [Reflector]),
      ]),
      exports: Object.freeze([
        AUTH_VERIFIER,
        ...verification.exports,
        AuthService,
        PasswordService,
        RefreshTokenService,
        RevocationService,
        AuthGuard,
        RolesGuard,
        PermissionsGuard,
      ]),
    });
  }
}

interface ResolvedVerification {
  readonly verifier: AuthVerifier;
  readonly providers: readonly Provider[];
  readonly exports: readonly Token<unknown>[];
}

function resolveTokenOptions(options: AuthModuleOptions["token"]): ResolvedAuthTokenOptions {
  const cookies = options?.cookieName;
  if (cookies !== undefined && (typeof cookies !== "string" || cookies.trim() === "")) {
    throw invalid("token.cookieName must be a non-empty string when present");
  }
  const scheme = options?.scheme ?? "Bearer";
  if (typeof scheme !== "string" || scheme.trim() === "") {
    throw invalid("token.scheme must be a non-empty string");
  }
  return Object.freeze({ cookieName: cookies, scheme });
}

function assertRefreshStore(store: RefreshTokenStore): void {
  if (typeof store !== "object" || store === null) {
    throw invalid("refresh.store must implement RefreshTokenStore");
  }
  const missing = ["create", "find", "delete", "deleteFamily", "clear"].filter(
    (method) => typeof (store as unknown as Record<string, unknown>)[method] !== "function",
  );
  if (missing.length > 0) {
    throw invalid(`refresh.store is missing ${missing.join(", ")}`);
  }
}

function assertRevocationStore(store: RevocationStore): void {
  if (typeof store !== "object" || store === null) {
    throw invalid("revocation.store must implement RevocationStore");
  }
  const missing = ["revoke", "isRevoked", "clear"].filter(
    (method) => typeof (store as unknown as Record<string, unknown>)[method] !== "function",
  );
  if (missing.length > 0) {
    throw invalid(`revocation.store is missing ${missing.join(", ")}`);
  }
}

function resolveVerification(options: AuthModuleOptions): ResolvedVerification {
  const wantsJwt = options.jwt !== undefined;
  const wantsOidc = options.oidc !== undefined;
  if (wantsJwt === wantsOidc) {
    throw invalid("exactly one of jwt or oidc must be present");
  }
  if (options.jwt !== undefined) {
    const jwt = new JwtService(resolveOptions({ jwt: options.jwt }));
    return Object.freeze({
      verifier: jwt,
      providers: Object.freeze([provideValue(JwtService, jwt)]),
      exports: Object.freeze([JwtService] as const),
    });
  }
  const oidc = new OidcService(options.oidc as NonNullable<AuthModuleOptions["oidc"]>);
  return Object.freeze({
    verifier: oidc,
    providers: Object.freeze([provideValue(OidcService, oidc)]),
    exports: Object.freeze([OidcService] as const),
  });
}

function resolveOptions(options: { readonly jwt: JwtOptions }): ResolvedJwtOptions {
  const jwt = options.jwt;
  if (typeof jwt.secret !== "string" || jwt.secret.length < 32) {
    throw invalid("jwt.secret must be a string of at least 32 characters");
  }
  if (jwt.issuer !== undefined && (typeof jwt.issuer !== "string" || jwt.issuer.trim() === "")) {
    throw invalid("jwt.issuer must be a non-empty string when present");
  }
  if (
    jwt.audience !== undefined &&
    (typeof jwt.audience !== "string" || jwt.audience.trim() === "")
  ) {
    throw invalid("jwt.audience must be a non-empty string when present");
  }
  const algorithms = jwt.algorithms ?? ["HS256"];
  if (
    !Array.isArray(algorithms) ||
    algorithms.length === 0 ||
    algorithms.some((algorithm) => typeof algorithm !== "string" || algorithm.trim() === "")
  ) {
    throw invalid("jwt.algorithms must be a non-empty array of strings");
  }
  const expiresIn = jwt.expiresIn ?? "1h";
  if (
    (typeof expiresIn !== "string" && typeof expiresIn !== "number") ||
    (typeof expiresIn === "string" && expiresIn.trim() === "")
  ) {
    throw invalid("jwt.expiresIn must be a non-empty string or a number");
  }

  const keys = jwt.keys ?? [];
  if (!Array.isArray(keys)) {
    throw invalid("jwt.keys must be an array when present");
  }
  const kids = new Set<string>();
  for (const key of keys) {
    if (typeof key !== "object" || key === null) {
      throw invalid("jwt.keys must contain key objects");
    }
    if (typeof key.kid !== "string" || key.kid.trim() === "") {
      throw invalid("jwt.keys entries need a non-empty kid");
    }
    if (kids.has(key.kid)) {
      throw invalid(`jwt.keys declares the kid "${key.kid}" twice`);
    }
    kids.add(key.kid);
    if (typeof key.secret !== "string" || key.secret.length < 32) {
      throw invalid(`jwt.keys entry "${key.kid}" needs a secret of at least 32 characters`);
    }
  }
  const activeKid = jwt.activeKid;
  if (activeKid !== undefined && !kids.has(activeKid)) {
    throw invalid("jwt.activeKid must name one of jwt.keys");
  }

  return Object.freeze({
    secret: jwt.secret,
    issuer: jwt.issuer,
    audience: jwt.audience,
    algorithms: Object.freeze([...algorithms]),
    expiresIn,
    keys: Object.freeze(keys.map((key) => Object.freeze({ kid: key.kid, secret: key.secret }))),
    activeKid,
  });
}

function invalid(issue: string): AponiaError {
  return new AponiaError("INVALID_AUTH_OPTIONS", `The auth registration is invalid: ${issue}.`, {
    issues: Object.freeze([issue]),
  });
}
