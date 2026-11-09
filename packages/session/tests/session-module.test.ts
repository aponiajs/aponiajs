import { afterEach, describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { AponiaError, Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { SessionModule, SessionService } from "../src/index.ts";
import type { ResolvedSessionOptions } from "../src/module/session.types.ts";
import { MemorySessionStore } from "../src/store/memory-session-store.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("SessionModule", () => {
  test("starts a session, reads it back, updates it, and destroys it", async () => {
    @Controller("session")
    class SessionController {
      constructor(private readonly sessions: SessionService) {}

      @Get("start")
      async start(): Promise<string> {
        const session = await this.sessions.start({ user: "ada" });
        return session.id;
      }

      @Get("me")
      me(): string {
        const user = this.sessions.current()?.data.user;
        return typeof user === "string" ? user : "anonymous";
      }

      @Get("update")
      async update(): Promise<string> {
        const session = await this.sessions.update({ user: "grace" });
        return String(session?.data.user ?? "none");
      }

      @Get("regenerate")
      async regenerate(): Promise<string> {
        const session = await this.sessions.regenerate({ user: "grace" });
        return `${session.id}:${String(session.data.user)}`;
      }

      @Get("destroy")
      async destroy(): Promise<string> {
        await this.sessions.destroy();
        return "destroyed";
      }
    }

    @Module({
      imports: [SessionModule.register({ secret: secret(), ttlMs: 60_000 })],
      controllers: [SessionController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    const anonymous = await application.handle(new Request("http://localhost/session/me"));
    expect(await anonymous.text()).toBe("anonymous");

    const started = await application.handle(new Request("http://localhost/session/start"));
    const token = readCookie(started.headers.get("set-cookie") ?? "", "aponia.sid");
    expect(token).toBeDefined();

    const me = await application.handle(
      new Request("http://localhost/session/me", { headers: { cookie: `aponia.sid=${token}` } }),
    );
    expect(await me.text()).toBe("ada");

    const updated = await application.handle(
      new Request("http://localhost/session/update", {
        headers: { cookie: `aponia.sid=${token}` },
      }),
    );
    expect(await updated.text()).toBe("grace");

    const regenerated = await application.handle(
      new Request("http://localhost/session/regenerate", {
        headers: { cookie: `aponia.sid=${token}` },
      }),
    );
    expect(await regenerated.text()).toEndWith(":grace");
    const rotated = readCookie(regenerated.headers.get("set-cookie") ?? "", "aponia.sid");
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(token);
    expect(
      await (
        await application.handle(
          new Request("http://localhost/session/me", {
            headers: { cookie: `aponia.sid=${token}` },
          }),
        )
      ).text(),
    ).toBe("anonymous");
    expect(
      await (
        await application.handle(
          new Request("http://localhost/session/me", {
            headers: { cookie: `aponia.sid=${rotated}` },
          }),
        )
      ).text(),
    ).toBe("grace");

    const destroyed = await application.handle(
      new Request("http://localhost/session/destroy", {
        headers: { cookie: `aponia.sid=${rotated}` },
      }),
    );
    expect(await destroyed.text()).toBe("destroyed");
    expect(destroyed.headers.get("set-cookie")).toContain("aponia.sid=;");
  });

  test("ignores and clears a tampered cookie", async () => {
    @Controller("tampered")
    class TamperedController {
      constructor(private readonly sessions: SessionService) {}

      @Get()
      read(): string {
        return this.sessions.current() === undefined ? "anonymous" : "session";
      }
    }

    @Module({
      imports: [SessionModule.register({ secret: secret() })],
      controllers: [TamperedController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(
      new Request("http://localhost/tampered", {
        headers: { cookie: "aponia.sid=not-a-session" },
      }),
    );

    expect(await response.text()).toBe("anonymous");
    expect(response.headers.get("set-cookie")).toContain("aponia.sid=;");

    const badSignature = await application.handle(
      new Request("http://localhost/tampered", {
        headers: { cookie: "aponia.sid=abc.deadbeef" },
      }),
    );
    expect(await badSignature.text()).toBe("anonymous");
    expect(badSignature.headers.get("set-cookie")).toContain("aponia.sid=;");
  });

  test("extends a rolling session when it is read", async () => {
    @Controller("rolling")
    class RollingController {
      constructor(private readonly sessions: SessionService) {}

      @Get("start")
      async start(): Promise<string> {
        return (await this.sessions.start({ user: "ada" })).id;
      }

      @Get("read")
      read(): string {
        const user = this.sessions.current()?.data.user;
        return typeof user === "string" ? user : "none";
      }
    }

    @Module({
      imports: [SessionModule.register({ secret: secret(), rolling: true })],
      controllers: [RollingController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const started = await application.handle(new Request("http://localhost/rolling/start"));
    const id = readCookie(started.headers.get("set-cookie") ?? "", "aponia.sid");
    expect(id).toBeDefined();

    const read = await application.handle(
      new Request("http://localhost/rolling/read", { headers: { cookie: `aponia.sid=${id}` } }),
    );
    expect(await read.text()).toBe("ada");
    expect(read.headers.get("set-cookie")).toContain("aponia.sid=");
  });

  test("reports every invalid session option in one refusal", () => {
    const error = captureAponiaError(() =>
      SessionModule.register({
        secret: "short",
        cookieName: "",
        ttlMs: 0,
        maxSessions: 0,
        cookie: { path: "" },
      }),
    );

    expect(error.code).toBe("INVALID_SESSION_OPTIONS");
    expect(error.details).toEqual({
      issues: [
        "secret must be a string of at least 32 characters",
        "cookieName must be a non-empty string",
        "ttlMs must be a positive integer",
        "maxSessions must be a positive integer",
        "cookie.path must be a non-empty string",
      ],
    });
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  test("reports operations that have no session in the current request", async () => {
    @Controller("empty-session")
    class EmptySessionController {
      constructor(private readonly sessions: SessionService) {}

      @Get("update")
      async update(): Promise<string> {
        return String((await this.sessions.update({ user: "grace" }))?.data.user ?? "none");
      }

      @Get("destroy")
      async destroy(): Promise<string> {
        return String(await this.sessions.destroy());
      }

      @Get("get")
      async get(): Promise<string> {
        const session = await this.sessions.get("missing");
        return session === undefined ? "missing" : session.id;
      }

      @Get("clear")
      async clear(): Promise<string> {
        await this.sessions.clear();
        return "cleared";
      }
    }

    @Module({
      imports: [SessionModule.register({ secret: secret() })],
      controllers: [EmptySessionController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    for (const [path, expected] of [
      ["update", "none"],
      ["destroy", "false"],
      ["get", "missing"],
      ["clear", "cleared"],
    ] as const) {
      const response = await application.handle(
        new Request(`http://localhost/empty-session/${path}`),
      );
      expect(await response.text()).toBe(expected);
    }
  });

  test("refuses a service call outside a session request", async () => {
    const options: ResolvedSessionOptions = {
      secret: secret(),
      cookieName: "aponia.sid",
      ttlMs: 60_000,
      maxSessions: 100,
      cookie: { secure: true, sameSite: "lax", path: "/", domain: undefined },
      rolling: false,
    };
    const service = new SessionService(new AsyncLocalStorage(), new MemorySessionStore(), options);

    for (const operation of [
      () => service.start(),
      () => service.update({}),
      () => service.destroy(),
      () => service.regenerate(),
    ]) {
      const outcome = await operation().catch((error: unknown) => error);
      expect(outcome).toMatchObject({ code: "MISSING_REQUEST_CONTEXT" });
    }
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
