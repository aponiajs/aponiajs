import { expect, test } from "bun:test";
import { Controller, Get, Module, UseGuards } from "@aponiajs/common";
import { createPlatformFactory, type AponiaApplicationContract } from "@aponiajs/platform-core";
import { h3Adapter } from "@aponiajs/platform-h3";
import { honoAdapter } from "@aponiajs/platform-hono";
import { RateLimit, RateLimitGuard, RateLimitModule } from "./index.ts";

// The guard keeps its window in the injected store and refuses through
// `httpErrors`, so the same module enforces one limit on every platform. A boot
// per platform is also the per-registration store the built-in store promises.
function createAppModule() {
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

  return AppModule;
}

async function assertLimitEnforced(application: AponiaApplicationContract): Promise<void> {
  expect((await application.handle(new Request("http://localhost/limited"))).status).toBe(200);
  expect((await application.handle(new Request("http://localhost/limited"))).status).toBe(200);
  expect((await application.handle(new Request("http://localhost/limited"))).status).toBe(429);
}

test("enforces the declared limit on hono", async () => {
  const application = await createPlatformFactory(honoAdapter()).create(createAppModule(), {
    logger: false,
  });

  try {
    await assertLimitEnforced(application);
  } finally {
    await application.close();
  }
});

test("enforces the declared limit on h3", async () => {
  const application = await createPlatformFactory(h3Adapter()).create(createAppModule(), {
    logger: false,
  });

  try {
    await assertLimitEnforced(application);
  } finally {
    await application.close();
  }
});
