import { Controller, Get, Module, Post, Req } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { SecurityModule, getCspNonce, type SecurityModuleOptions } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("exposes the documented security options", () => {
  const options: SecurityModuleOptions = {
    headers: { frameOptions: "DENY", contentSecurityPolicy: false },
    csrf: { secret: "x".repeat(32), cookieName: "csrf" },
  };

  expect(options.headers).toBeDefined();
  expect(options.csrf?.cookieName).toBe("csrf");
});

test("issues a per-request CSP nonce", async () => {
  @Controller("page")
  class PageController {
    @Get()
    read(@Req() request: Request): string {
      return getCspNonce(request) ?? "none";
    }
  }

  @Module({
    imports: [
      SecurityModule.register({
        headers: { contentSecurityPolicy: "script-src 'nonce-{nonce}'" },
      }),
    ],
    controllers: [PageController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const response = await application.handle(new Request("http://localhost/page"));
    const nonce = await response.text();

    expect(nonce).not.toBe("none");
    expect(response.headers.get("content-security-policy")).toBe(`script-src 'nonce-${nonce}'`);
  } finally {
    await application.close();
  }
});

test("sets headers and enforces CSRF through the mounted plugin", async () => {
  @Controller("secure")
  class SecureController {
    @Get()
    read(): string {
      return "ok";
    }

    @Post("submit")
    submit(): string {
      return "submitted";
    }
  }

  @Module({
    imports: [SecurityModule.register({ csrf: { secret: "x".repeat(32) } })],
    controllers: [SecureController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const form = await application.handle(new Request("http://localhost/secure"));
    expect(form.headers.get("x-frame-options")).toBe("DENY");
    expect(form.headers.get("set-cookie")).toContain("aponia.csrf=");

    const refused = await application.handle(
      new Request("http://localhost/secure/submit", { method: "POST" }),
    );
    expect(refused.status).toBe(403);
  } finally {
    await application.close();
  }
});
