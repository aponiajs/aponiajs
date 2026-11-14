import { Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AuditModule, AuditService, type AuditModuleOptions } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("exposes the documented audit contract", () => {
  const options: AuditModuleOptions = { maxEntries: 10, redact: ["ssn"] };
  expect(options.maxEntries).toBe(10);
});

test("boots and records through the injected service", async () => {
  @Module({ imports: [AuditModule.register()] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const audit = application.get(AuditService);
    const event = await audit.record({ action: "test", outcome: "success" });
    expect(event.action).toBe("test");
    expect((await audit.list()).length).toBe(1);
  } finally {
    await application.close();
  }
});
