import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  Reflector,
  SetMetadata,
  UseGuards,
  type ExecutionContext,
} from "@aponiajs/common";
import { AponiaFactory, AuthGuard, RolesGuard } from "../src/index.ts";

const Roles = (...roles: readonly string[]) => SetMetadata("roles", roles);
const Public = () => SetMetadata("isPublic", true);

@Injectable()
class CustomAuthGuard extends AuthGuard {
  protected override validateToken(token: string, _context: ExecutionContext): boolean {
    return token === "valid-secret-token";
  }
}

@Controller("auth-protected")
@UseGuards(CustomAuthGuard)
class AuthProtectedController {
  @Get("profile")
  getProfile(): { status: string } {
    return { status: "authenticated" };
  }
}

@Controller("rbac")
@UseGuards(RolesGuard)
class RbacController {
  @Get("admin")
  @Roles("admin")
  getAdmin(): { ok: boolean } {
    return { ok: true };
  }

  @Get("editor")
  @Roles("admin", "editor")
  getEditor(): { ok: boolean } {
    return { ok: true };
  }

  @Get("public")
  @Public()
  @Roles("admin")
  getPublic(): { public: boolean } {
    return { public: true };
  }
}

@Module({
  controllers: [AuthProtectedController, RbacController],
  providers: [CustomAuthGuard, RolesGuard, Reflector],
})
class SecurityModule {}

describe("AuthGuard & RolesGuard", () => {
  test("AuthGuard refuses when Authorization header is missing", async () => {
    const app = await AponiaFactory.create(SecurityModule, { logger: false });
    const response = await app.handle(new Request("http://localhost/auth-protected/profile"));

    expect(response.status).toBe(401);
    await app.close();
  });

  test("AuthGuard refuses when Bearer token is invalid", async () => {
    const app = await AponiaFactory.create(SecurityModule, { logger: false });
    const response = await app.handle(
      new Request("http://localhost/auth-protected/profile", {
        headers: { authorization: "Bearer invalid-token" },
      }),
    );

    expect(response.status).toBe(401);
    await app.close();
  });

  test("AuthGuard allows request with valid Bearer token", async () => {
    const app = await AponiaFactory.create(SecurityModule, { logger: false });
    const response = await app.handle(
      new Request("http://localhost/auth-protected/profile", {
        headers: { authorization: "Bearer valid-secret-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "authenticated" });
    await app.close();
  });

  test("RolesGuard refuses when user has no roles or missing user", async () => {
    const app = await AponiaFactory.create(SecurityModule, { logger: false });
    const response = await app.handle(new Request("http://localhost/rbac/admin"));

    expect(response.status).toBe(403);
    await app.close();
  });

  test("RolesGuard permits when route is marked @Public()", async () => {
    const app = await AponiaFactory.create(SecurityModule, { logger: false });
    const response = await app.handle(new Request("http://localhost/rbac/public"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ public: true });
    await app.close();
  });

  test("RolesGuard permits when user has required role", () => {
    const reflector = new Reflector();
    const guard = new RolesGuard(reflector);

    class TestHandler {
      static handler(this: void): void {}
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      TestHandler,
      "handler",
    ) as TypedPropertyDescriptor<unknown>;
    Roles("admin")(TestHandler, "handler", descriptor);

    const allowedContext = {
      getHandler: () => TestHandler.handler,
      getClass: () => TestHandler,
      switchToHttp: () => ({
        getRequest: () => ({ user: { roles: ["admin"] } }),
      }),
    };
    expect(guard.canActivate(allowedContext as any)).toBe(true);

    const forbiddenContext = {
      getHandler: () => TestHandler.handler,
      getClass: () => TestHandler,
      switchToHttp: () => ({
        getRequest: () => ({ user: { roles: ["guest"] } }),
      }),
    };
    expect(() => guard.canActivate(forbiddenContext as any)).toThrow();
  });

  test("AuthGuard default validateToken passes non-empty token", async () => {
    const defaultGuard = new AuthGuard();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          request: new Request("http://localhost/test", {
            headers: { authorization: "Bearer basic-token" },
          }),
        }),
      }),
    };
    expect(await defaultGuard.canActivate(context as any)).toBe(true);

    const badScheme = {
      switchToHttp: () => ({
        getRequest: () => ({
          request: new Request("http://localhost/test", {
            headers: { authorization: "Basic token" },
          }),
        }),
      }),
    };
    await expect(defaultGuard.canActivate(badScheme as any)).rejects.toThrow();
  });
});
