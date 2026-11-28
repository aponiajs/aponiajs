import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  SessionModule,
  SessionService,
  type Session,
  type SessionModuleOptions,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("exposes the documented session contract", () => {
  const options: SessionModuleOptions = { secret: "x".repeat(32), ttlMs: 1_000 };
  const session: Session = { id: "one", data: { user: "ada" }, createdAt: 1, expiresAt: 2 };

  expect(options.ttlMs).toBe(1_000);
  expect(session.data.user).toBe("ada");
});

test("boots and starts a session through the injected service", async () => {
  @Controller("session")
  class SessionController {
    constructor(private readonly sessions: SessionService) {}

    @Get("start")
    async start(): Promise<string> {
      return (await this.sessions.start({ user: "ada" })).id;
    }

    @Get("regenerate")
    async regenerate(): Promise<string> {
      return (await this.sessions.regenerate({ user: "ada" })).id;
    }
  }

  @Module({
    imports: [SessionModule.register({ secret: "x".repeat(32) })],
    controllers: [SessionController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const response = await application.handle(new Request("http://localhost/session/start"));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("aponia.sid=");
    const token = cookieValue(response.headers.get("set-cookie") ?? "");

    const rotated = await application.handle(
      new Request("http://localhost/session/regenerate", {
        headers: { cookie: `aponia.sid=${token}` },
      }),
    );
    expect(cookieValue(rotated.headers.get("set-cookie") ?? "")).not.toBe(token);
  } finally {
    await application.close();
  }
});

function cookieValue(setCookie: string): string {
  return setCookie.split(";")[0]?.split("=")[1] ?? "";
}
