import { afterAll, beforeAll, expect, test } from "bun:test";
import { type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { createApplication, get, send } from "./application.ts";

let application: AponiaElysiaApplication;
let itemId: string;

beforeAll(async () => {
  application = await createApplication();
  const created = await send(application, "/items", "POST", { name: "Hammer", quantity: 1 });
  itemId = ((await created.json()) as { id: string }).id;
});

afterAll(async () => {
  await application.close();
});

test("POST creates through the schema-validated route", async () => {
  const response = await send(application, "/items", "POST", { name: "Chisel", quantity: 4 });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ name: "Chisel", quantity: 4 });
});

test("GET reads one item by path parameter", async () => {
  const response = await get(application, `/items/${itemId}`);

  expect(await response.json()).toMatchObject({ id: itemId, name: "Hammer" });
});

test("GET answers a miss without throwing", async () => {
  expect(await (await get(application, "/items/does-not-exist")).json()).toEqual({
    message: "not found",
  });
});

test("PUT replaces an item", async () => {
  const response = await send(application, `/items/${itemId}`, "PUT", {
    name: "Mallet",
    quantity: 3,
  });

  expect(await response.json()).toEqual({ id: itemId, name: "Mallet", quantity: 3 });
});

test("PATCH takes its input from the query string", async () => {
  const response = await get(application, `/items/${itemId}?name=Sledge`, { method: "PATCH" });

  expect(await response.json()).toEqual({ id: itemId, name: "Sledge" });
});

test("DELETE reports whether the item existed", async () => {
  const created = await send(application, "/items", "POST", { name: "Spare", quantity: 1 });
  const { id } = (await created.json()) as { id: string };

  expect(await (await get(application, `/items/${id}`, { method: "DELETE" })).json()).toEqual({
    id,
    removed: true,
  });
  expect(await (await get(application, `/items/${id}`, { method: "DELETE" })).json()).toEqual({
    id,
    removed: false,
  });
});

test("HEAD answers without a body", async () => {
  const response = await get(application, "/items", { method: "HEAD" });

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("");
});

test("OPTIONS answers from the injected service", async () => {
  expect(await (await get(application, "/items", { method: "OPTIONS" })).json()).toEqual({
    description: "The catalog holds every item this example serves.",
  });
});

test("answers 404 for a path no controller mapped", async () => {
  expect((await get(application, "/items/1/unmapped/deep")).status).toBe(404);
});

test("serves a second router mounted under its own prefix", async () => {
  expect(await (await get(application, "/health")).json()).toEqual({ status: "ok" });
  expect(await (await get(application, "/health/ready")).json()).toEqual({ ready: true });
});

test("keeps each router behind its own prefix", async () => {
  expect((await get(application, "/health/does-not-exist")).status).toBe(404);
  expect((await get(application, "/ready")).status).toBe(404);
});
