import { afterEach, describe, expect, test } from "bun:test";
import { Controller, Get, Module, UseGuards } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import {
  AuthGuard,
  AuthModule,
  CurrentSession,
  CurrentUser,
  JwtService,
  Public,
  type AuthSession,
  type AuthUser,
} from "./index.ts";

const secret = "z".repeat(32);

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

@Controller("who")
class WhoController {
  @Get("me")
  me(
    @CurrentUser() user: AuthUser | null,
    @CurrentUser("sub") sub: AuthUser,
    @CurrentSession() session: AuthSession | null,
  ): unknown {
    return { user, sub, token: session?.token };
  }

  @Public()
  @Get("public")
  anonymous(
    @CurrentUser() user: AuthUser | null,
    @CurrentSession() session: AuthSession | null,
  ): unknown {
    return { user, session };
  }
}

describe("the @nestjs/authentication-shaped current-user surface", () => {
  test("a default global guard protects every route and the decorators read the user", async () => {
    @Module({
      imports: [AuthModule.forRoot({ jwt: { secret } })],
      controllers: [WhoController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    const refused = await application.handle(new Request("http://localhost/who/me"));
    expect(refused.status).toBe(401);

    const token = await application.get(JwtService).sign({ sub: "ada", roles: ["admin"] });
    const allowed = await application.handle(
      new Request("http://localhost/who/me", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({
      user: expect.objectContaining({ sub: "ada" }),
      sub: "ada",
      token,
    });

    const anonymous = await application.handle(new Request("http://localhost/who/public"));
    expect(await anonymous.json()).toEqual({ user: null, session: null });
  });

  test("globalGuard: false leaves the guard to the route", async () => {
    @Controller("open")
    class OpenController {
      @Get()
      read(@CurrentUser() user: AuthUser | null): unknown {
        return { user };
      }
    }

    @Controller("guarded")
    @UseGuards(AuthGuard)
    class GuardedController {
      @Get()
      read(): string {
        return "guarded";
      }
    }

    @Module({
      imports: [AuthModule.forRoot({ jwt: { secret }, globalGuard: false })],
      controllers: [OpenController, GuardedController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    const open = await application.handle(new Request("http://localhost/open"));
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({ user: null });

    const guarded = await application.handle(new Request("http://localhost/guarded"));
    expect(guarded.status).toBe(401);
  });
});
