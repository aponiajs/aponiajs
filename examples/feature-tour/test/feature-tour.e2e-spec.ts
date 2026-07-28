import { afterAll, beforeAll, expect, test } from "bun:test";
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

let application: AponiaElysiaApplication;

beforeAll(async () => {
  application = await AponiaFactory.create(AppModule, { logger: false });
});

afterAll(async () => {
  await application.close();
});

function get(path: string, init?: RequestInit): Promise<Response> {
  return Promise.resolve(application.handle(new Request(`http://localhost${path}`, init)));
}

function send(path: string, method: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    application.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  );
}

test("validates a body with a Standard Schema validator", async () => {
  const accepted = await send("/items", "POST", { name: "Anvil", quantity: 2 });
  const rejected = await send("/items", "POST", { name: "A", quantity: 2 });

  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toMatchObject({ name: "Anvil", quantity: 2 });
  expect(rejected.status).toBe(422);
});

test("validates a query with a platform-native validator", async () => {
  await send("/items", "POST", { name: "Rope", quantity: 5 });

  const accepted = await get("/items/search?term=rop&take=1");
  const rejected = await get("/items/search");

  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toHaveLength(1);
  expect(rejected.status).toBe(422);
});

test("maps every HTTP method decorator", async () => {
  const created = await send("/items", "POST", { name: "Hammer", quantity: 1 });
  const { id } = (await created.json()) as { id: string };

  expect((await get(`/items/${id}`)).status).toBe(200);
  expect((await send(`/items/${id}`, "PUT", { name: "Mallet", quantity: 3 })).status).toBe(200);
  expect((await get(`/items/${id}?name=Sledge`, { method: "PATCH" })).status).toBe(200);
  expect((await get(`/items/${id}`, { method: "DELETE" })).status).toBe(200);
  expect((await get("/items", { method: "HEAD" })).status).toBe(200);
  expect(await (await get("/items", { method: "OPTIONS" })).json()).toEqual({
    description: "Hello from feature-tour, catalog!",
  });
});

test("injects every request parameter decorator", async () => {
  const body = await send("/parameters/body", "POST", { name: "Chisel", quantity: 4 });
  expect(await body.json()).toEqual({
    body: { name: "Chisel", quantity: 4 },
    name: "Chisel",
  });

  expect(await (await get("/parameters/query?term=x&other=y")).json()).toEqual({
    query: { term: "x", other: "y" },
    term: "x",
  });
  expect(await (await get("/parameters/params/42")).json()).toEqual({ id: "42" });
  expect(
    await (await get("/parameters/headers", { headers: { "x-tenant": "acme" } })).json(),
  ).toEqual({ tenant: "acme" });
  expect(await (await get("/parameters/cookies")).json()).toEqual({ session: null });
  expect(await (await get("/parameters/request")).json()).toEqual({
    method: "GET",
    path: "/parameters/request",
  });
  expect(await (await get("/parameters/context")).json()).toEqual({ path: "/parameters/context" });

  const response = await get("/parameters/response");
  expect(response.headers.get("x-source")).toBe("parameters");
});

test("exposes a native plugin's decorators, state, and derives", async () => {
  const response = await get("/status");
  const body = (await response.json()) as { now: string; traceId: string; requests: number };

  expect(response.status).toBe(200);
  expect(Date.parse(body.now)).not.toBeNaN();
  expect(body.traceId).toHaveLength(36);
  expect(body.requests).toBeGreaterThan(0);
});

test("configures a plugin from an injected provider", async () => {
  expect(await (await get("/status/budget")).json()).toEqual({ budget: 100 });
});

test("serves a controller written as a hand-made descriptor", async () => {
  expect(await (await get("/metrics")).json()).toEqual({ namespace: "feature-tour", hits: 1 });
});

test("resolves value, factory, class, and alias providers", async () => {
  const response = await get("/items", { method: "OPTIONS" });

  expect(await response.json()).toEqual({
    description: "Hello from feature-tour, catalog!",
  });
});
