import { afterEach, expect, test } from "bun:test";
import { Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { AuditModule, AuditService } from "../index.ts";

test("forRootAsync resolves the registration options", async () => {
  @Module({ imports: [AuditModule.forRootAsync({ useFactory: () => ({ maxEntries: 5 }) })] })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });

  expect(application.get(AuditService)).toBeDefined();
});

test("forRootAsync refuses an invalid factory result at boot", async () => {
  @Module({ imports: [AuditModule.forRootAsync({ useFactory: () => ({ maxEntries: 0 }) })] })
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
