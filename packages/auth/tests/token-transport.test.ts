import { afterEach, describe, expect, test } from "bun:test";
import { AponiaError, Controller, Get, Module, UseGuards } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { AuthGuard, AuthModule, AuthService, JwtService } from "../src/index.ts";

const secret = "x".repeat(32);
let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

@Controller("me")
@UseGuards(AuthGuard)
class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  read(): string {
    return String(this.auth.current()?.id ?? "none");
  }
}

async function boot(token: { cookieName?: string; scheme?: string } | undefined) {
  @Module({
    imports: [AuthModule.register({ jwt: { secret }, ...(token === undefined ? {} : { token }) })],
    controllers: [MeController],
  })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });
  return application;
}

describe("access-token transport", () => {
  test("reads a JWT from the configured cookie and prefers the header", async () => {
    const app = await boot({ cookieName: "aponia.at" });
    const jwt = app.get(JwtService);
    const cookieToken = await jwt.sign({ sub: "cookie" });
    const headerToken = await jwt.sign({ sub: "header" });

    const fromCookie = await app.handle(
      new Request("http://localhost/me", {
        headers: { cookie: `aponia.at=${cookieToken}` },
      }),
    );
    expect(await fromCookie.text()).toBe("cookie");

    const fromHeader = await app.handle(
      new Request("http://localhost/me", {
        headers: { authorization: `Bearer ${headerToken}` },
      }),
    );
    expect(await fromHeader.text()).toBe("header");

    const both = await app.handle(
      new Request("http://localhost/me", {
        headers: {
          cookie: `aponia.at=${cookieToken}`,
          authorization: `Bearer ${headerToken}`,
        },
      }),
    );
    expect(await both.text()).toBe("header");
  });

  test("answers 401 for a missing or malformed cookie and ignores it when not configured", async () => {
    const app = await boot({ cookieName: "aponia.at" });
    const cookieToken = await app.get(JwtService).sign({ sub: "cookie" });

    expect((await app.handle(new Request("http://localhost/me"))).status).toBe(401);
    expect(
      (
        await app.handle(
          new Request("http://localhost/me", { headers: { cookie: "aponia.at=not-a-token" } }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await app.handle(
          new Request("http://localhost/me", {
            headers: { cookie: `other=${cookieToken}` },
          }),
        )
      ).status,
    ).toBe(401);

    await application?.close();
    const plain = await boot(undefined);
    expect(
      (
        await plain.handle(
          new Request("http://localhost/me", {
            headers: { cookie: `aponia.at=${cookieToken}` },
          }),
        )
      ).status,
    ).toBe(401);
  });

  test("accepts a custom authorization scheme", async () => {
    const app = await boot({ scheme: "Token" });
    const token = await app.get(JwtService).sign({ sub: "custom" });

    const accepted = await app.handle(
      new Request("http://localhost/me", { headers: { authorization: `Token ${token}` } }),
    );
    const refused = await app.handle(
      new Request("http://localhost/me", { headers: { authorization: `Bearer ${token}` } }),
    );

    expect(await accepted.text()).toBe("custom");
    expect(refused.status).toBe(401);
  });

  test("refuses an empty cookie name or scheme", () => {
    expect(
      capture(() => AuthModule.register({ jwt: { secret }, token: { cookieName: " " } })).code,
    ).toBe("INVALID_AUTH_OPTIONS");
    expect(
      capture(() => AuthModule.register({ jwt: { secret }, token: { scheme: " " } })).code,
    ).toBe("INVALID_AUTH_OPTIONS");
  });
});

function capture(run: () => unknown): AponiaError {
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
