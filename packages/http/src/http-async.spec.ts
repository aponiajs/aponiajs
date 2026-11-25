import { afterEach, expect, test } from "bun:test";
import { Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { HTTP_CLIENT_MODULE_OPTIONS, HttpModule } from "./index.ts";

test("forRootAsync resolves the app-wide defaults and registers no client", async () => {
  @Module({ imports: [HttpModule.forRootAsync({ useFactory: () => ({ timeoutMs: 500 }) })] })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });

  expect(application.get(HTTP_CLIENT_MODULE_OPTIONS)).toMatchObject({ timeoutMs: 500 });
});

test("forRootAsync refuses an invalid factory result at boot", async () => {
  @Module({ imports: [HttpModule.forRootAsync({ useFactory: () => ({ timeoutMs: 0 }) })] })
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
