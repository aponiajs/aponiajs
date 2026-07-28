import { afterAll, beforeAll, expect, test } from "bun:test";
import { Module } from "@aponiajs/common";
import {
  AponiaFactory,
  defineElysiaPlugin,
  type AponiaElysiaApplication,
} from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import { createApplication, get } from "./application.ts";

let application: AponiaElysiaApplication;

beforeAll(async () => {
  application = await createApplication();
});

afterAll(async () => {
  await application.close();
});

test("exposes a plugin decorator to a controller", async () => {
  const body = (await (await get(application, "/plugins")).json()) as { now: string };

  expect(Date.parse(body.now)).not.toBeNaN();
});

test("exposes plugin state, shared across requests", async () => {
  const first = (await (await get(application, "/plugins")).json()) as { requests: number };
  const second = (await (await get(application, "/plugins")).json()) as { requests: number };

  expect(second.requests).toBe(first.requests + 1);
});

test("exposes a global derive, computed per request", async () => {
  const first = (await (await get(application, "/plugins")).json()) as { traceId: string };
  const second = (await (await get(application, "/plugins")).json()) as { traceId: string };

  expect(first.traceId).toHaveLength(36);
  expect(second.traceId).not.toBe(first.traceId);
});

test("exposes a scoped derive", async () => {
  const body = (await (await get(application, "/plugins")).json()) as { scope: string };

  expect(body.scope).toBe("request");
});

test("keeps a plugin-local derive inside the plugin", async () => {
  expect(await (await get(application, "/plugins/plugin-local")).json()).toEqual({
    pluginOnly: null,
  });
});

test("configures a plugin from an injected provider", async () => {
  expect(await (await get(application, "/plugins/budget")).json()).toEqual({ budget: 100 });
});

test("installs a plugin shared by two modules only once", async () => {
  let installations = 0;
  const counted = defineElysiaPlugin(
    new Elysia({ name: "counted" }).onStart(() => {
      installations += 1;
    }),
    { key: "counted" },
  );

  @Module({ imports: [counted] })
  class LeftModule {}

  @Module({ imports: [counted] })
  class RightModule {}

  @Module({ imports: [LeftModule, RightModule] })
  class SharedPluginModule {}

  const shared = await AponiaFactory.create(SharedPluginModule, { logger: false });
  await shared.close();

  expect(installations).toBeLessThanOrEqual(1);
});

test("rejects two different plugins registered under one key", () => {
  const first = defineElysiaPlugin(new Elysia({ name: "first" }), { key: "duplicate" });
  const second = defineElysiaPlugin(new Elysia({ name: "second" }), { key: "duplicate" });

  @Module({ imports: [first, second] })
  class DuplicateKeyModule {}

  expect(AponiaFactory.create(DuplicateKeyModule, { logger: false })).rejects.toThrow(
    expect.objectContaining({ code: "DUPLICATE_MODULE" }),
  );
});

test("rejects an empty plugin key", () => {
  expect(() => defineElysiaPlugin(new Elysia(), { key: "   " })).toThrow(
    "Elysia plugin module key must not be empty.",
  );
});
