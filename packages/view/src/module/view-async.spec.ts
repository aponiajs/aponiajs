import { afterEach, expect, test } from "bun:test";
import { Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { VIEW_ENGINE, ViewModule, ViewService } from "../index.ts";

test("forRootAsync resolves the registration options", async () => {
  @Module({ imports: [ViewModule.forRootAsync({ useFactory: () => ({ defaultEngine: "html" }) })] })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });

  expect(application.get(VIEW_ENGINE)).toBeDefined();
  expect(application.get(ViewService)).toBeDefined();
});

test("forRootAsync refuses an unknown engine name at boot", async () => {
  @Module({ imports: [ViewModule.forRootAsync({ useFactory: () => ({ defaultEngine: "pug" }) })] })
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
