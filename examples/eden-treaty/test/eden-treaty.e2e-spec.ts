import { afterAll, beforeAll, expect, test } from "bun:test";
import { treaty, type Treaty } from "@elysia/eden";
import type { AponiaApplication } from "@aponiajs/platform-elysia";
import type { App } from "../src/main.ts";
import { createApplication } from "./application.ts";

let application: AponiaApplication<App>;
let client: Treaty.Create<App>;

beforeAll(async () => {
  application = await createApplication();
  client = treaty(application.getNativeApplication());
});

afterAll(async () => {
  await application.close();
});

test("fetches all users with inline schema inference", async () => {
  const result = await client.users.get();

  expect(result.status).toBe(200);
  expect(result.data).toHaveLength(2);
  expect(result.data?.[0]).toEqual({ id: 1, name: "Ada Lovelace" });
});

test("fetches a single user with path params and separate DTO schema", async () => {
  const result = await client.users({ id: 2 }).get();

  expect(result.status).toBe(200);
  expect(result.data).toEqual({ id: 2, name: "Grace Hopper" });
});

test("creates a user using separate DTO schema", async () => {
  const result = await client.users.post({ name: "Margaret Hamilton" });

  expect(result.status).toBe(200);
  expect(result.data).toEqual({ id: 3, name: "Margaret Hamilton" });

  const list = await client.users.get();
  expect(list.data).toHaveLength(3);
});

test("rejects invalid payload matching schema constraints at runtime", async () => {
  const result = await client.users.post({ name: "M" });

  expect(result.status).toBe(422);
});

test("statically rejects invalid payload types at compile-time", () => {
  function assertInvalidCalls() {
    // @ts-expect-error Name must be a string, not a number
    void client.users.post({ name: 123 });
    // @ts-expect-error Path param must be a number or string, not boolean
    void client.users({ id: true }).get();
  }
  expect(assertInvalidCalls).toBeFunction();
});
