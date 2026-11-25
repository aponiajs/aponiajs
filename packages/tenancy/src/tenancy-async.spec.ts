import { afterEach, expect, test } from "bun:test";
import { Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { TenantModule, TenantService } from "./index.ts";

test("forRootAsync resolves the registration options", async () => {
  @Module({
    imports: [TenantModule.forRootAsync({ useFactory: () => ({ header: "x-tenant-id" }) })],
  })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });

  expect(application.get(TenantService)).toBeDefined();
});

test("forRootAsync refuses a factory result that states no tenant source", async () => {
  @Module({ imports: [TenantModule.forRootAsync({ useFactory: () => ({}) })] })
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
