import { afterAll, beforeAll, expect, test } from "bun:test";
import { type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { createApplication, get, send } from "./application.ts";

let application: AponiaElysiaApplication;

beforeAll(async () => {
  application = await createApplication();
});

afterAll(async () => {
  await application.close();
});

test("accepts a body matching the Standard Schema validator", async () => {
  const response = await send(application, "/validated/items", "POST", {
    name: "Anvil",
    quantity: 2,
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ name: "Anvil", quantity: 2 });
});

test("rejects a body that violates a field constraint", async () => {
  const response = await send(application, "/validated/items", "POST", { name: "A", quantity: 2 });

  expect(response.status).toBe(422);
});

test("rejects a body with the wrong type", async () => {
  const response = await send(application, "/validated/items", "POST", {
    name: "Anvil",
    quantity: "two",
  });

  expect(response.status).toBe(422);
});

test("rejects a body missing a required field", async () => {
  const response = await send(application, "/validated/items", "POST", { name: "Anvil" });

  expect(response.status).toBe(422);
});

test("accepts a query matching the platform-native validator", async () => {
  await send(application, "/validated/items", "POST", { name: "Rope", quantity: 5 });
  const response = await get(application, "/validated/items?term=rop&take=1");

  expect(response.status).toBe(200);
  expect(await response.json()).toHaveLength(1);
});

test("rejects a query missing a required parameter", async () => {
  expect((await get(application, "/validated/items")).status).toBe(422);
});

test("rejects a query parameter that fails its constraint", async () => {
  expect((await get(application, "/validated/items?term=")).status).toBe(422);
});

test("validates headers through the same slot mechanism", async () => {
  const accepted = await get(application, "/validated/tenant", {
    headers: { "x-tenant": "acme" },
  });
  const rejected = await get(application, "/validated/tenant");

  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({ tenant: "acme" });
  expect(rejected.status).toBe(422);
});

test("never runs the handler for a rejected request", async () => {
  const before = await get(application, "/validated/items?term=never");
  await send(application, "/validated/items", "POST", { name: "n", quantity: 1 });
  const after = await get(application, "/validated/items?term=never");

  expect(await before.json()).toEqual(await after.json());
});
