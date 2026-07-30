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

test("@Body injects the whole body and one named property", async () => {
  const response = await send(application, "/parameters/body", "POST", {
    name: "Chisel",
    quantity: 4,
  });

  expect(await response.json()).toEqual({
    body: { name: "Chisel", quantity: 4 },
    name: "Chisel",
  });
});

test("@Query injects the whole query and one named parameter", async () => {
  expect(await (await get(application, "/parameters/query?term=x&other=y")).json()).toEqual({
    query: { term: "x", other: "y" },
    term: "x",
  });
});

test("drops an absent named query parameter from the response", async () => {
  // The handler receives `undefined`, which JSON serialization omits entirely.
  expect(await (await get(application, "/parameters/query")).json()).toEqual({ query: {} });
});

test("@Param injects the whole map and one named parameter", async () => {
  expect(await (await get(application, "/parameters/params/42")).json()).toEqual({
    id: "42",
    params: { id: "42" },
  });
});

test("@Headers injects a named header", async () => {
  expect(
    await (
      await get(application, "/parameters/headers", { headers: { "x-tenant": "acme" } })
    ).json(),
  ).toEqual({ tenant: "acme" });
});

test("@Headers yields null for a header the request omits", async () => {
  expect(await (await get(application, "/parameters/headers")).json()).toEqual({ tenant: null });
});

test("@Cookie reads a named cookie", async () => {
  const response = await get(application, "/parameters/cookies", {
    headers: { cookie: "session=abc" },
  });

  expect(await response.json()).toEqual({ session: "abc" });
});

test("@Req injects the native Request", async () => {
  expect(await (await get(application, "/parameters/request")).json()).toEqual({
    method: "GET",
    path: "/parameters/request",
  });
});

test("@Res writes response settings the client observes", async () => {
  const response = await get(application, "/parameters/response");

  expect(response.headers.get("x-source")).toBe("parameters");
  expect(await response.json()).toEqual({ written: true });
});

test("@Set and @Status expose native Elysia response parts", async () => {
  const response = await get(application, "/parameters/native-response");

  expect(response.status).toBe(202);
  expect(response.headers.get("x-source")).toBe("native-parts");
  expect(await response.json()).toEqual({ written: true });
});

test("@Ctx injects the whole platform context", async () => {
  expect(await (await get(application, "/parameters/context")).json()).toEqual({
    path: "/parameters/context",
  });
});

test("a handler without parameter decorators receives the context", async () => {
  expect(await (await get(application, "/parameters/whole-context")).json()).toEqual({
    path: "/parameters/whole-context",
  });
});
