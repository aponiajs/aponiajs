import { afterAll, beforeAll, expect, test } from "bun:test";
import { Module, createToken, provideFactory, provideValue } from "@aponiajs/common";
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { createApplication, get } from "./application.ts";

let application: AponiaElysiaApplication;

beforeAll(async () => {
  application = await createApplication();
});

afterAll(async () => {
  await application.close();
});

test("resolves a value provider", async () => {
  const body = (await (await get(application, "/settings")).json()) as { application: string };

  expect(body.application).toBe("feature-tour");
});

test("resolves a factory provider from another token", async () => {
  const body = (await (await get(application, "/settings")).json()) as { prefix: string };

  expect(body.prefix).toBe("Hello from feature-tour");
});

test("resolves a class provider with token dependencies", async () => {
  const response = await get(application, "/items", { method: "OPTIONS" });

  expect(await response.json()).toEqual({ description: "Hello from feature-tour, catalog!" });
});

test("resolves an alias to the token it points at", async () => {
  expect(await (await get(application, "/plugins/budget")).json()).toEqual({ budget: 100 });
});

test("keeps a provider that is not exported invisible to importers", async () => {
  const HIDDEN = createToken<string>("HIDDEN");

  @Module({ providers: [provideValue(HIDDEN, "secret")] })
  class PrivateModule {}

  @Module({
    imports: [PrivateModule],
    providers: [provideFactory(createToken<string>("LEAK"), [HIDDEN], (value) => value)],
  })
  class LeakingModule {}

  expect(AponiaFactory.create(LeakingModule, { logger: false })).rejects.toThrow(
    expect.objectContaining({ code: "MISSING_PROVIDER" }),
  );
});

test("instantiates a singleton once per module", async () => {
  const first = (await (await get(application, "/metrics")).json()) as { hits: number };
  const second = (await (await get(application, "/metrics")).json()) as { hits: number };

  expect(second.hits).toBe(first.hits + 1);
});
