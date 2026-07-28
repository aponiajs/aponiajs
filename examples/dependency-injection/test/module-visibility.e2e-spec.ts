import { afterAll, beforeAll, expect, test } from "bun:test";
import { Module, createToken, provideValue } from "@aponiajs/common";
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { createApplication, get } from "./application.ts";

let application: AponiaElysiaApplication;

beforeAll(async () => {
  application = await createApplication();
});

afterAll(async () => {
  await application.close();
});

test("shares an exported service with the module that imports it", async () => {
  const response = await get(application, "/settings/greeting");

  expect(await response.json()).toEqual({
    greeting: "Hello from dependency-injection, catalog!",
  });
});

test("rejects an import cycle before the container is built", () => {
  const TOKEN = createToken<string>("CYCLE");

  @Module({ providers: [provideValue(TOKEN, "a")] })
  class FirstModule {}

  const first = { module: FirstModule, id: "First", instanceId: Symbol("First"), imports: [] };
  const second = {
    module: FirstModule,
    id: "Second",
    instanceId: Symbol("Second"),
    imports: [first],
  };
  (first.imports as unknown[]).push(second);

  expect(AponiaFactory.create(second, { logger: false })).rejects.toThrow(
    expect.objectContaining({ code: "MODULE_CYCLE" }),
  );
});

test("rejects two imports exporting the same token", () => {
  const SHARED = createToken<string>("SHARED");

  @Module({ providers: [provideValue(SHARED, "left")], exports: [SHARED] })
  class LeftModule {}

  @Module({ providers: [provideValue(SHARED, "right")], exports: [SHARED] })
  class RightModule {}

  @Module({ imports: [LeftModule, RightModule], exports: [SHARED] })
  class AmbiguousModule {}

  expect(AponiaFactory.create(AmbiguousModule, { logger: false })).rejects.toThrow(
    expect.objectContaining({ code: "AMBIGUOUS_PROVIDER" }),
  );
});

test("rejects exporting a token the module cannot resolve", () => {
  const ABSENT = createToken<string>("ABSENT");

  @Module({ exports: [ABSENT] })
  class InvalidExportModule {}

  expect(AponiaFactory.create(InvalidExportModule, { logger: false })).rejects.toThrow(
    expect.objectContaining({ code: "INVALID_EXPORT" }),
  );
});
