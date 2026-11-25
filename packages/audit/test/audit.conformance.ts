import { Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  AuditModule,
  AuditService,
  MODULE_OPTIONS_TOKEN,
  type AuditModuleOptions,
} from "../src/index.ts";

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

test("the registration is a builder definition with an options token and extras", () => {
  const definition = AuditModule.forRoot({ maxEntries: 5, isGlobal: true });
  const asyncDefinition = AuditModule.forRootAsync({
    useFactory: async () => ({ maxEntries: 5 }),
  });

  expect(definition.module).toBe(AuditModule);
  expect(definition.global).toBe(true);
  expect(definition.exports).toContain(MODULE_OPTIONS_TOKEN);
  expect(asyncDefinition.exports).toContain(MODULE_OPTIONS_TOKEN);
  expect(() => AuditModule.forRoot({ maxEntries: 0 })).toThrow();
});
