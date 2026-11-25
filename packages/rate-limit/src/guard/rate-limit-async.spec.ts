import { afterEach, expect, test } from "bun:test";
import { Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { RateLimitModule, RateLimitService } from "../index.ts";

test("forRootAsync resolves the registration options", async () => {
  @Module({
    imports: [RateLimitModule.forRootAsync({ useFactory: () => ({ limit: 5, windowMs: 1_000 }) })],
  })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });

  expect(application.get(RateLimitService)).toBeDefined();
});

test("forRootAsync refuses an invalid factory result at boot", async () => {
  @Module({ imports: [RateLimitModule.forRootAsync({ useFactory: () => ({ limit: 0 }) })] })
  class AppModule {}

  let failure: unknown;
  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(Error);
});

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});
