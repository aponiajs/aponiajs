import { Controller, Get, Module, UseGuards, type ExecutionContext } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  RateLimit,
  RateLimitGuard,
  RateLimitModule,
  RateLimitService,
  type RateLimitOptions,
  type RateLimitStore,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("exposes the documented options and decision contract", () => {
  const options: RateLimitOptions = {
    limit: 5,
    windowMs: 1_000,
    maxKeys: 10,
    key: (context: ExecutionContext) => context.getRoute().path,
  };
  const store: RateLimitStore = {
    increment: () => ({ count: 1, resetAt: 1 }),
  };

  expect(options.limit).toBe(5);
  expect(store.increment("key", 1)).toEqual({ count: 1, resetAt: 1 });
});

test("boots and refuses through the guard", async () => {
  @Controller("limited")
  @UseGuards(RateLimitGuard)
  class LimitedController {
    @Get()
    @RateLimit({ limit: 1, windowMs: 60_000 })
    read(): string {
      return "ok";
    }
  }

  @Module({
    imports: [RateLimitModule.register()],
    controllers: [LimitedController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const first = await application.handle(new Request("http://localhost/limited"));
    const second = await application.handle(new Request("http://localhost/limited"));

    expect(first.status).toBe(200);
    expect(first.headers.get("ratelimit-limit")).toBe("1");
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toMatch(/^[1-9]\d*$/);
    expect(application.get(RateLimitService).limit).toBe(60);
  } finally {
    await application.close();
  }
});
