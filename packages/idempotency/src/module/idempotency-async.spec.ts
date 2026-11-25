import { afterEach, expect, test } from "bun:test";
import { Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { IdempotencyModule } from "../index.ts";

test("forRootAsync mounts the plugin from a factory", async () => {
  @Module({ imports: [IdempotencyModule.forRootAsync({ useFactory: () => ({ ttlMs: 1_000 }) })] })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });

  expect(application).toBeDefined();
});

test("forRootAsync refuses an invalid factory result at boot", async () => {
  @Module({ imports: [IdempotencyModule.forRootAsync({ useFactory: () => ({ ttlMs: -1 }) })] })
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
