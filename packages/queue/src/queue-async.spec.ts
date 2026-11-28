import { afterEach, expect, test } from "bun:test";
import { Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { OutboxService, QueueModule, QueueService } from "./index.ts";

test("forRootAsync resolves the registration options", async () => {
  @Module({ imports: [QueueModule.forRootAsync({ useFactory: () => ({}) })] })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });

  expect(application.get(QueueService)).toBeDefined();
  expect(application.get(OutboxService)).toBeDefined();
});

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});
