import { Controller, Get, Module, UseGuards } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  AuthGuard,
  AuthModule,
  AuthService,
  JwtService,
  MemoryRefreshTokenStore,
  MemoryRevocationStore,
  OidcService,
  Permissions,
  PermissionsGuard,
  Public,
  RefreshTokenService,
  RevocationService,
  Roles,
  RolesGuard,
  type AuthModuleOptions,
  type AuthTokenOptions,
  type OidcOptions,
  type JwtKey,
  type RefreshTokenRecord,
  type RefreshTokenStore,
  type RevocationStore,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("exposes the documented auth contract", () => {
  const options: AuthModuleOptions = { jwt: { secret: "x".repeat(32) } };
  expect(options.jwt.secret).toHaveLength(32);
});

test("boots and authorizes a JWT through the guards", async () => {
  @Controller("auth")
  @UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
  class AuthController {
    constructor(private readonly auth: AuthService) {}

    @Public()
    @Get("public")
    publicRoute(): string {
      return "public";
    }

    @Roles("admin")
    @Permissions("users:read")
    @Get("me")
    me(): string {
      return String(this.auth.current()?.id ?? "none");
    }
  }

  @Module({
    imports: [AuthModule.register({ jwt: { secret: "x".repeat(32) } })],
    controllers: [AuthController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    expect((await application.handle(new Request("http://localhost/auth/public"))).status).toBe(
      200,
    );
    const token = await application.get(JwtService).sign({
      sub: "ada",
      roles: ["admin"],
      permissions: ["users:read"],
    });
    const response = await application.handle(
      new Request("http://localhost/auth/me", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(await response.text()).toBe("ada");
  } finally {
    await application.close();
  }
});

test("rotates refresh tokens and rejects a token after revocation", async () => {
  const refresh = new RefreshTokenService(new MemoryRefreshTokenStore(), { ttlMs: 60_000 });
  const issued = await refresh.issue("ada");
  const rotated = await refresh.rotate(issued.token);

  expect(rotated.familyId).toBe(issued.familyId);
  await expect(refresh.rotate(issued.token)).rejects.toThrow("invalid, expired, or already used");

  const revocation = new RevocationService(new MemoryRevocationStore());
  await revocation.revoke("access-1", Date.now() + 60_000);
  expect(await revocation.isRevoked("access-1")).toBe(true);
});

test("accepts a supplied refresh store and shares its records", async () => {
  const records = new Map<string, RefreshTokenRecord>();
  const store: RefreshTokenStore = {
    create: (record) => {
      records.set(record.idHash, record);
    },
    find: (idHash) => records.get(idHash),
    delete: (idHash) => records.delete(idHash),
    deleteFamily: (familyId) => {
      let deleted = 0;
      for (const [key, record] of records) {
        if (record.familyId === familyId) {
          records.delete(key);
          deleted += 1;
        }
      }
      return deleted;
    },
    clear: () => records.clear(),
  };
  const revocation: RevocationStore = {
    revoke: () => {},
    isRevoked: () => false,
    clear: () => {},
  };
  const options: AuthModuleOptions = {
    jwt: { secret: "x".repeat(32) },
    refresh: { store },
    revocation: { store: revocation },
  };
  const service = new RefreshTokenService(store);
  const issued = await service.issue("ada");
  const rotated = await service.rotate(issued.token);

  expect(options.refresh?.store).toBe(store);
  expect(rotated.familyId).toBe(issued.familyId);
  expect(records.size).toBe(1);
});

test("accepts a cookie token transport", () => {
  const token: AuthTokenOptions = { cookieName: "aponia.at", scheme: "Token" };
  const options: AuthModuleOptions = { jwt: { secret: "x".repeat(32) }, token };

  expect(options.token?.cookieName).toBe("aponia.at");
  expect(options.token?.scheme).toBe("Token");
});

test("accepts a signing-key rotation list", () => {
  const key: JwtKey = { kid: "current", secret: "x".repeat(32) };
  const jwt: AuthModuleOptions["jwt"] = {
    secret: "y".repeat(32),
    keys: [key],
    activeKid: "current",
  };

  expect(jwt?.activeKid).toBe("current");
  expect(jwt?.keys?.[0]?.kid).toBe("current");
});

test("accepts either a local secret or an OIDC issuer", () => {
  const oidc: OidcOptions = { issuer: "https://issuer.example" };
  const options: AuthModuleOptions = { oidc, refresh: { ttlMs: 60_000 } };

  expect(options.oidc?.audience).toBeUndefined();
  expect(() => new OidcService({ issuer: "" })).toThrow("registration is invalid");
});
