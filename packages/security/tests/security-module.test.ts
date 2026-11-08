import { afterEach, describe, expect, test } from "bun:test";
import { AponiaError, Controller, Get, Module, Post, Req } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { SecurityModule, getCspNonce } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("SecurityModule headers", () => {
  test("sets conservative security headers on a matched route and a missing route", async () => {
    @Controller("secure")
    class SecureController {
      @Get()
      read(): string {
        return "ok";
      }
    }

    @Module({ imports: [SecurityModule.register()], controllers: [SecureController] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    const matched = await application.handle(new Request("http://localhost/secure"));
    const missing = await application.handle(new Request("http://localhost/missing"));

    for (const response of [matched, missing]) {
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    }
  });

  test("replaces the CSP nonce placeholder with a per-request nonce", async () => {
    @Controller("nonce")
    class NonceController {
      @Get()
      read(@Req() request: Request): string {
        return getCspNonce(request) ?? "none";
      }
    }

    @Module({
      imports: [
        SecurityModule.register({
          headers: { contentSecurityPolicy: "default-src 'self'; script-src 'nonce-{nonce}'" },
        }),
      ],
      controllers: [NonceController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const first = await application.handle(new Request("http://localhost/nonce"));
    const second = await application.handle(new Request("http://localhost/nonce"));
    const firstNonce = await first.text();
    const secondNonce = await second.text();

    expect(firstNonce).not.toBe("none");
    expect(firstNonce).not.toBe(secondNonce);
    expect(first.headers.get("content-security-policy")).toBe(
      `default-src 'self'; script-src 'nonce-${firstNonce}'`,
    );
    expect(second.headers.get("content-security-policy")).toContain(
      `script-src 'nonce-${secondNonce}'`,
    );
  });

  test("answers no nonce when the policy states no placeholder", async () => {
    @Controller("plain")
    class PlainController {
      @Get()
      read(@Req() request: Request): string {
        return getCspNonce(request) ?? "none";
      }
    }

    @Module({ imports: [SecurityModule.register()], controllers: [PlainController] })
    class PlainModule {}

    const plainApplication = await AponiaFactory.create(PlainModule, { logger: false });
    try {
      expect(
        await (await plainApplication.handle(new Request("http://localhost/plain"))).text(),
      ).toBe("none");
    } finally {
      await plainApplication.close();
    }
  });

  test("merges a partial header override with the defaults", async () => {
    @Controller("custom")
    class CustomController {
      @Get()
      read(): string {
        return "ok";
      }
    }

    @Module({
      imports: [
        SecurityModule.register({
          headers: { frameOptions: "SAMEORIGIN", contentSecurityPolicy: false },
        }),
      ],
      controllers: [CustomController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(new Request("http://localhost/custom"));

    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("can disable headers entirely", async () => {
    @Controller("plain")
    class PlainController {
      @Get()
      read(): string {
        return "ok";
      }
    }

    @Module({
      imports: [SecurityModule.register({ headers: false })],
      controllers: [PlainController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(new Request("http://localhost/plain"));

    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeNull();
  });
});

describe("SecurityModule CSRF", () => {
  test("issues a signed cookie and requires its token on an unsafe request", async () => {
    @Controller("form")
    class FormController {
      @Get()
      read(): string {
        return "form";
      }

      @Post("submit")
      submit(): string {
        return "submitted";
      }
    }

    @Module({
      imports: [SecurityModule.register({ csrf: { secret: secret() } })],
      controllers: [FormController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    const form = await application.handle(new Request("http://localhost/form"));
    const setCookie = form.headers.get("set-cookie") ?? "";
    const token = readCookie(setCookie, "aponia.csrf");
    expect(token).toBeDefined();

    const missing = await application.handle(
      new Request("http://localhost/form/submit", { method: "POST" }),
    );
    expect(missing.status).toBe(403);
    expect(missing.headers.get("content-type")).toContain("application/problem+json");

    const accepted = await application.handle(
      new Request("http://localhost/form/submit", {
        method: "POST",
        headers: {
          cookie: `aponia.csrf=${token}`,
          "x-csrf-token": token!,
        },
      }),
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toBe("submitted");
  });

  test("rejects a tampered or mismatched token", async () => {
    @Controller("tamper")
    class TamperController {
      @Post("submit")
      submit(): string {
        return "submitted";
      }
    }

    @Module({
      imports: [SecurityModule.register({ csrf: { secret: secret() } })],
      controllers: [TamperController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const form = await application.handle(
      new Request("http://localhost/tamper/submit", { method: "POST" }),
    );
    expect(form.status).toBe(403);

    const token = "not-a-valid-token";
    const response = await application.handle(
      new Request("http://localhost/tamper/submit", {
        method: "POST",
        headers: { cookie: `aponia.csrf=${token}`, "x-csrf-token": token },
      }),
    );
    expect(response.status).toBe(403);
  });

  test("skips an excluded path", async () => {
    @Controller("hook")
    class HookController {
      @Post("callback")
      callback(): string {
        return "callback";
      }
    }

    @Module({
      imports: [
        SecurityModule.register({
          csrf: { secret: secret(), exclude: ["/hook/callback"] },
        }),
      ],
      controllers: [HookController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(
      new Request("http://localhost/hook/callback", { method: "POST" }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("callback");
  });

  test("reports every invalid security option in one refusal", () => {
    const error = captureAponiaError(() =>
      SecurityModule.register({
        csrf: { secret: "short", cookieName: "", headerName: "", maxAge: 0 },
      }),
    );

    expect(error.code).toBe("INVALID_SECURITY_OPTIONS");
    expect(error.details).toEqual({
      issues: [
        "csrf.secret must be a string of at least 32 characters",
        "csrf.cookieName must be a non-empty string",
        "csrf.headerName must be a non-empty string",
        "csrf.maxAge must be a positive integer",
      ],
    });
    expect(Object.isFrozen(error.details)).toBe(true);
  });
});

function secret(): string {
  return "x".repeat(32);
}

function readCookie(setCookie: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|,\\s*)${name}=([^;]+)`).exec(setCookie);
  return match?.[1] === undefined ? undefined : decodeURIComponent(match[1]);
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
