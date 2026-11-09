import { afterEach, describe, expect, test } from "bun:test";
import { AponiaError, Controller, Get, Module, UseGuards } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import {
  AuthGuard,
  AuthModule,
  AuthService,
  JwtService,
  PasswordService,
  Permissions,
  PermissionsGuard,
  Public,
  Roles,
  RolesGuard,
} from "../src/index.ts";
import { mapVerifiedClaims } from "../src/authentication/claims.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("AuthModule", () => {
  test("lowers id fallback claims and rejects an empty password", async () => {
    expect(mapVerifiedClaims({ id: 7, roles: ["admin"], permissions: ["x"] })).toMatchObject({
      id: 7,
      roles: ["admin"],
      permissions: ["x"],
    });
    expect(mapVerifiedClaims({ roles: ["admin", 1] }).roles).toEqual(["admin", 1] as never);
    expect(new PasswordService().verify("", "hash")).rejects.toMatchObject({
      code: "INVALID_AUTH_OPTIONS",
    });
  });

  test("serves public routes and protects the rest", async () => {
    @Controller("auth")
    @UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
    class AuthController {
      constructor(private readonly auth: AuthService) {}

      @Public()
      @Get("public")
      publicRoute(): string {
        return "public";
      }

      @Get("me")
      me(): string {
        return String(this.auth.current()?.id ?? "none");
      }

      @Roles("admin")
      @Get("admin")
      admin(): string {
        return "admin";
      }

      @Permissions("users:read")
      @Get("permissions")
      permissions(): string {
        return "permissions";
      }
    }

    @Module({
      imports: [AuthModule.register({ jwt: { secret: secret() } })],
      controllers: [AuthController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    expect((await application.handle(new Request("http://localhost/auth/public"))).status).toBe(
      200,
    );
    expect((await application.handle(new Request("http://localhost/auth/me"))).status).toBe(401);
    expect(
      (
        await application.handle(
          new Request("http://localhost/auth/me", { headers: { authorization: "Bearer nope" } }),
        )
      ).status,
    ).toBe(401);

    const token = await application.get(JwtService).sign({
      sub: "ada",
      roles: ["admin"],
      permissions: ["users:read"],
    });
    const headers = { authorization: `Bearer ${token}` };

    expect(
      await (await application.handle(new Request("http://localhost/auth/me", { headers }))).text(),
    ).toBe("ada");
    expect(
      (await application.handle(new Request("http://localhost/auth/admin", { headers }))).status,
    ).toBe(200);
    expect(
      (await application.handle(new Request("http://localhost/auth/permissions", { headers })))
        .status,
    ).toBe(200);
  });

  test("refuses a token without the required role or permission", async () => {
    @Controller("denied")
    @UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
    class DeniedController {
      @Roles("admin")
      @Get("role")
      role(): string {
        return "role";
      }

      @Permissions("users:write")
      @Get("permission")
      permission(): string {
        return "permission";
      }
    }

    @Module({
      imports: [AuthModule.register({ jwt: { secret: secret() } })],
      controllers: [DeniedController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const token = await application.get(JwtService).sign({
      sub: "viewer",
      roles: ["viewer"],
      permissions: ["users:read"],
    });
    const headers = { authorization: `Bearer ${token}` };

    expect(
      (await application.handle(new Request("http://localhost/denied/role", { headers }))).status,
    ).toBe(403);
    expect(
      (await application.handle(new Request("http://localhost/denied/permission", { headers })))
        .status,
    ).toBe(403);
  });

  test("hashes and verifies a password", async () => {
    const passwords = new PasswordService();
    const hash = await passwords.hash("correct horse battery staple");

    expect(await passwords.verify("correct horse battery staple", hash)).toBe(true);
    expect(await passwords.verify("wrong", hash)).toBe(false);
  });

  test("reports an invalid auth registration", () => {
    const error = captureAponiaError(() => AuthModule.register({ jwt: { secret: "short" } }));

    expect(error.code).toBe("INVALID_AUTH_OPTIONS");
    expect(error.details).toEqual({
      issues: ["jwt.secret must be a string of at least 32 characters"],
    });
  });
});

function secret(): string {
  return "x".repeat(32);
}

function captureAponiaError(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an AponiaError.");
}
