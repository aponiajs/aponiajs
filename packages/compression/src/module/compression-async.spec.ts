import { afterEach, expect, test } from "bun:test";
import { Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { CompressionModule } from "../index.ts";

test("forRootAsync mounts the plugin from a factory", async () => {
  @Module({ imports: [CompressionModule.forRootAsync({ useFactory: () => ({}) })] })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });

  expect(application).toBeDefined();
});

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});
