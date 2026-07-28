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

  expect(body.application).toBe("dependency-injection");
});

test("resolves a factory provider from another token", async () => {
  const body = (await (await get(application, "/settings")).json()) as { prefix: string };

  expect(body.prefix).toBe("Hello from dependency-injection");
});

test("resolves a class provider with token dependencies", async () => {
  const response = await get(application, "/settings/greeting");

  expect(await response.json()).toEqual({
    greeting: "Hello from dependency-injection, catalog!",
  });
});

test("resolves an alias to the token it points at", async () => {
  expect(await (await get(application, "/settings/budget")).json()).toEqual({ budget: 100 });
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

test("keeps one controller instance across requests", async () => {
  const first = (await (await get(application, "/settings/reads")).json()) as { reads: number };
  const second = (await (await get(application, "/settings/reads")).json()) as { reads: number };

  expect(second.reads).toBe(first.reads + 1);
});
