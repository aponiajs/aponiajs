import { afterAll, beforeAll, expect, test } from "bun:test";
import { defineModule, provideValue, createToken } from "@aponiajs/common";
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { createApplication, get } from "./application.ts";

let application: AponiaElysiaApplication;

beforeAll(async () => {
  application = await createApplication();
});

afterAll(async () => {
  await application.close();
});

test("serves a controller built from hand-written descriptors", async () => {
  const response = await get(application, "/metrics");

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ namespace: "feature-tour" });
});

test("keeps descriptor state in one singleton instance", async () => {
  const first = (await (await get(application, "/metrics")).json()) as { hits: number };
  const second = (await (await get(application, "/metrics")).json()) as { hits: number };

  expect(second.hits).toBe(first.hits + 1);
});

test("freezes what a descriptor helper returns", () => {
  const module = defineModule({
    id: "FrozenModule",
    providers: [provideValue(createToken<string>("FROZEN"), "value")],
  });

  expect(Object.isFrozen(module)).toBe(true);
  expect(Object.isFrozen(module.providers)).toBe(true);
});

test("mixes descriptor modules and decorated modules in one graph", async () => {
  const decoratedRouteWorks = await get(application, "/settings");
  const descriptorRouteWorks = await get(application, "/metrics");

  expect(decoratedRouteWorks.status).toBe(200);
  expect(descriptorRouteWorks.status).toBe(200);
});

test("rejects a controller whose factory does not return an Elysia instance", () => {
  const invalidModule = defineModule({
    id: "InvalidControllerModule",
    controllers: [
      {
        kind: "aponia.elysia.controller",
        token: class Broken {},
        inject: [],
        useClass: class Broken {},
        buildPlugin: () => ({}) as never,
      } as never,
    ],
  });

  expect(AponiaFactory.create(invalidModule, { logger: false })).rejects.toThrow(
    expect.objectContaining({ code: "UNSUPPORTED_CONTROLLER" }),
  );
});
