import { afterEach, expect, test } from "bun:test";
import { Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { MetricsModule, MetricsRegistry } from "./index.ts";

test("forRootAsync provides the registry its plugin records into", async () => {
  @Module({ imports: [MetricsModule.forRootAsync({ useFactory: () => ({}) })] })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });

  expect(application.get(MetricsRegistry)).toBeDefined();
});

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});
