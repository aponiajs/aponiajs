import { afterAll, beforeAll, expect, test } from "bun:test";
import { Module, createToken, provideValue } from "@aponiajs/common";
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { createApplication, get, send } from "./application.ts";

let application: AponiaElysiaApplication;

beforeAll(async () => {
  application = await createApplication();
});

afterAll(async () => {
  await application.close();
});

test("shares an exported service across module boundaries", async () => {
  const created = await send(application, "/items", "POST", { name: "Anvil", quantity: 2 });
  const { id } = (await created.json()) as { id: string };

  const found = await get(application, `/items/${id}`);

  expect(await found.json()).toMatchObject({ id, name: "Anvil" });
});

test("serves two controllers backed by the same singleton service", async () => {
  const created = await send(application, "/validated/items", "POST", {
    name: "Shared",
    quantity: 1,
  });
  const { id } = (await created.json()) as { id: string };

  expect(await (await get(application, `/items/${id}`)).json()).toMatchObject({ name: "Shared" });
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
