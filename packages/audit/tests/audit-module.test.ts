import { afterEach, describe, expect, test } from "bun:test";
import { Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { AuditModule, AuditService, MemoryAuditStore } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("AuditModule", () => {
  test("records a frozen event and redacts sensitive metadata", async () => {
    @Module({ imports: [AuditModule.register()] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const audit = application.get(AuditService);
    const event = await audit.record({
      action: "user.login",
      outcome: "success",
      actor: "ada",
      metadata: { password: "secret", token: "abc", tenant: "acme", plan: "pro" },
    });

    expect(event).toMatchObject({
      action: "user.login",
      outcome: "success",
      actor: "ada",
      metadata: { password: "[redacted]", token: "[redacted]", tenant: "acme", plan: "pro" },
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.metadata)).toBe(true);
    expect(await audit.list()).toEqual([event]);
  });

  test("redacts nested metadata, freezes it, and isolates the caller's object", async () => {
    @Module({ imports: [AuditModule.register()] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const audit = application.get(AuditService);
    const input = {
      user: { password: "secret", profile: { token: "abc" } },
      tags: ["a"],
    };

    const event = await audit.record({
      action: "user.profile.read",
      outcome: "success",
      metadata: input,
    });

    expect(event.metadata).toEqual({
      user: { password: "[redacted]", profile: { token: "[redacted]" } },
      tags: ["a"],
    });
    expect(Object.isFrozen(event.metadata)).toBe(true);
    expect(Object.isFrozen(event.metadata?.["user"])).toBe(true);
    expect(Object.isFrozen(event.metadata?.["tags"])).toBe(true);

    input.user.password = "changed";
    input.tags.push("b");
    const stored = (await audit.list())[0]!;
    expect(stored.metadata).toEqual({
      user: { password: "[redacted]", profile: { token: "[redacted]" } },
      tags: ["a"],
    });
  });

  test("breaks a metadata cycle without throwing", async () => {
    @Module({ imports: [AuditModule.register()] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const audit = application.get(AuditService);
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic["self"] = cyclic;

    const event = await audit.record({ action: "cycle", outcome: "success", metadata: cyclic });

    expect(event.metadata).toEqual({ name: "loop", self: "[circular]" });
  });

  test("keeps a caller key named __proto__ as an own entry instead of a prototype", async () => {
    @Module({ imports: [AuditModule.register()] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const audit = application.get(AuditService);
    const input = JSON.parse('{"__proto__":{"polluted":true},"tenant":"acme"}') as Record<
      string,
      unknown
    >;

    const event = await audit.record({ action: "proto", outcome: "success", metadata: input });
    const stored = event.metadata as Record<string, unknown>;

    expect(Object.getPrototypeOf(stored)).toBe(Object.prototype);
    expect(Object.hasOwn(stored, "__proto__")).toBe(true);
    expect(stored.polluted).toBeUndefined();
    expect(Object.isFrozen(stored)).toBe(true);
  });

  test("supports a custom redaction key and clears the store", async () => {
    const store = new MemoryAuditStore({ maxEntries: 2 });
    expect(store.size).toBe(0);
    store.record({
      action: "a",
      outcome: "success",
      actor: "a",
      metadata: {},
      timestamp: Date.now(),
    });
    expect(store.size).toBe(1);
    store.clear();
    expect(store.size).toBe(0);

    @Module({ imports: [AuditModule.register({ store, redact: ["ssn"] })] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const audit = application.get(AuditService);
    const first = await audit.record({ action: "a", outcome: "success", metadata: { ssn: "1" } });
    const second = await audit.record({ action: "b", outcome: "failure" });
    const third = await audit.record({ action: "c", outcome: "denied" });

    expect(first.metadata).toEqual({ ssn: "[redacted]" });
    expect((await audit.list()).map((event) => event.action)).toEqual(["b", "c"]);
    await audit.clear();
    expect(await audit.list()).toEqual([]);
    expect(second.action).toBe("b");
    expect(third.action).toBe("c");
  });

  test("refuses an empty action and an invalid store bound", async () => {
    expect(() => new MemoryAuditStore({ maxEntries: 0 })).toThrow(
      expect.objectContaining({ code: "INVALID_AUDIT_OPTIONS" }),
    );
    expect(() => AuditModule.register({ maxEntries: 0 })).toThrow(
      expect.objectContaining({ code: "INVALID_AUDIT_OPTIONS" }),
    );

    const service = new AuditService(new MemoryAuditStore());
    expect(service.record({ action: "", outcome: "success" })).rejects.toMatchObject({
      code: "INVALID_AUDIT_OPTIONS",
    });
  });
});
