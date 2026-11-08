import { afterEach, describe, expect, test } from "bun:test";
import { AponiaError, Controller, Get, Module, UseGuards } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { RateLimit, RateLimitGuard, RateLimitModule, RateLimitService } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("RateLimitGuard", () => {
  test("allows the configured limit, exposes headers, and refuses the next request", async () => {
    @Controller("limited")
    @UseGuards(RateLimitGuard)
    class LimitedController {
      @Get()
      @RateLimit({ limit: 2, windowMs: 60_000 })
      read(): string {
        return "ok";
      }
    }

    @Module({
      imports: [RateLimitModule.register()],
      controllers: [LimitedController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    const first = await application.handle(new Request("http://localhost/limited"));
    const second = await application.handle(new Request("http://localhost/limited"));
    const third = await application.handle(new Request("http://localhost/limited"));

    expect(first.status).toBe(200);
    expect(first.headers.get("ratelimit-limit")).toBe("2");
    expect(first.headers.get("ratelimit-remaining")).toBe("1");
    expect(second.status).toBe(200);
    expect(second.headers.get("ratelimit-remaining")).toBe("0");
    expect(third.status).toBe(429);
    expect(third.headers.get("content-type")).toContain("application/problem+json");
    expect(third.headers.get("retry-after")).toMatch(/^[1-9]\d*$/);
    expect(first.headers.get("retry-after")).toBeNull();
  });

  test("uses a registration default when the route declares no override", async () => {
    @Controller("default")
    @UseGuards(RateLimitGuard)
    class DefaultController {
      @Get()
      read(): string {
        return "ok";
      }
    }

    @Module({
      imports: [RateLimitModule.register({ limit: 1, windowMs: 60_000 })],
      controllers: [DefaultController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    const first = await application.handle(new Request("http://localhost/default"));
    const second = await application.handle(new Request("http://localhost/default"));

    expect(first.status).toBe(200);
    expect(first.headers.get("ratelimit-limit")).toBe("1");
    expect(second.status).toBe(429);
  });

  test("isolates two routes by the default route-identity key", async () => {
    @Controller("routes")
    @UseGuards(RateLimitGuard)
    class RoutesController {
      @Get("first")
      first(): string {
        return "first";
      }

      @Get("second")
      second(): string {
        return "second";
      }
    }

    @Module({
      imports: [RateLimitModule.register({ limit: 1, windowMs: 60_000 })],
      controllers: [RoutesController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    expect((await application.handle(new Request("http://localhost/routes/first"))).status).toBe(
      200,
    );
    expect((await application.handle(new Request("http://localhost/routes/second"))).status).toBe(
      200,
    );
    expect((await application.handle(new Request("http://localhost/routes/first"))).status).toBe(
      429,
    );
  });

  test("accepts a route-specific key function", async () => {
    @Controller("keyed")
    @UseGuards(RateLimitGuard)
    class KeyedController {
      @Get()
      @RateLimit({
        limit: 1,
        key: (context) => context.switchToHttp().getRequest().headers["x-bucket"] ?? "none",
      })
      read(): string {
        return "ok";
      }
    }

    @Module({
      imports: [RateLimitModule.register()],
      controllers: [KeyedController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    const first = await application.handle(
      new Request("http://localhost/keyed", { headers: { "x-bucket": "first" } }),
    );
    const second = await application.handle(
      new Request("http://localhost/keyed", { headers: { "x-bucket": "second" } }),
    );
    const third = await application.handle(
      new Request("http://localhost/keyed", { headers: { "x-bucket": "first" } }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
  });

  test("reports every invalid registration option in one boot-time refusal", () => {
    const error = captureAponiaError(() =>
      RateLimitModule.register({ limit: 0, windowMs: 0, maxKeys: 0 }),
    );

    expect(error.code).toBe("INVALID_RATE_LIMIT");
    expect(error.details).toEqual({
      issues: [
        "limit must be a positive integer",
        "windowMs must be a positive integer",
        "maxKeys must be a positive integer",
      ],
    });
  });

  test("exposes the service decision for a custom guard", async () => {
    @Module({ imports: [RateLimitModule.register({ limit: 1, windowMs: 60_000 })] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const service = application.get(RateLimitService);

    expect(service.limit).toBe(1);
    expect(service.windowMs).toBe(60_000);

    const first = await service.check("custom");
    const second = await service.check("custom");

    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(0);
    expect(second.allowed).toBe(false);
    expect(second.remaining).toBe(0);

    expect(await captureAponiaErrorAsync(() => service.check("custom", { limit: 0 }))).toEqual(
      expect.objectContaining({ code: "INVALID_RATE_LIMIT" }),
    );
    expect(await captureAponiaErrorAsync(() => service.check("custom", { windowMs: 0 }))).toEqual(
      expect.objectContaining({ code: "INVALID_RATE_LIMIT" }),
    );
  });
});

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

async function captureAponiaErrorAsync(run: () => Promise<unknown>): Promise<AponiaError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an AponiaError.");
}
