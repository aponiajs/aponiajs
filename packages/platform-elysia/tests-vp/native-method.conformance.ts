import { AponiaError, type RouteContext } from "@aponiajs/common";
import { Elysia, t } from "elysia";
import { registerNativeRoute } from "../src/routing/native-route.ts";
import type { NativeMethodRegistration } from "../src/routing/native-route.types.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

// These tests exercise the candidate ABI, not an installed Elysia 2 runtime.
// The real-runtime migration suite remains a prerequisite for changing peers.

test("passes the schema before the handler and preserves the native method receiver", () => {
  const calls: unknown[][] = [];
  const receivers: unknown[] = [];
  const application = {
    method(this: unknown, ...arguments_: unknown[]) {
      receivers.push(this);
      calls.push(arguments_);
    },
  } as unknown as Elysia;
  const handler = () => "accepted";
  const hook = { body: t.Object({ name: t.String() }) };

  registerNativeRoute(application, "POST", "/candidate", handler, hook);

  expect(receivers).toEqual([application]);
  expect(calls).toEqual([["POST", "/candidate", hook, handler]]);
  expect(calls[0]?.[2]).toBe(hook);
  expect(calls[0]?.[3]).toBe(handler);
});

test("supplies an empty schema object when the candidate method has no route schema", () => {
  const calls: unknown[][] = [];
  const application = {
    method: (...arguments_: unknown[]) => calls.push(arguments_),
  } as unknown as Elysia;
  const handler = () => "plain";

  registerNativeRoute(application, "GET", "/candidate", handler, undefined);

  expect(calls).toEqual([["GET", "/candidate", {}, handler]]);
});

test("keeps the supported legacy API authoritative when both capabilities exist", () => {
  const calls: string[] = [];
  const application = {
    route: () => calls.push("route"),
    method: () => calls.push("method"),
  } as unknown as Elysia;

  registerNativeRoute(application, "GET", "/candidate", () => "plain", undefined);

  expect(calls).toEqual(["route"]);
});

test("does not replace a native method registration failure with a version error", () => {
  const failure = new Error("native registration failed");
  const application = {
    method: () => {
      throw failure;
    },
  } as unknown as Elysia;
  let caught: unknown;

  try {
    registerNativeRoute(application, "GET", "/candidate", () => "plain", undefined);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBe(failure);
});

test("rejects non-callable registration capabilities with frozen structured details", () => {
  const application = { route: false, method: null } as unknown as Elysia;
  let caught: unknown;

  try {
    registerNativeRoute(application, "GET", "/candidate", () => "plain", undefined);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AponiaError);
  expect(caught).toEqual(
    expect.objectContaining({
      code: "UNSUPPORTED_ELYSIA_VERSION",
      details: { method: "GET", path: "/candidate", supported: "1.4.x" },
    }),
  );
  expect(Object.isFrozen((caught as AponiaError).details)).toBe(true);
});

test("preserves request validation through a method-to-legacy ABI harness", async () => {
  const application = new Elysia();
  const legacyRoute = application.route;
  const method: NativeMethodRegistration = function (method, path, hook, handler) {
    legacyRoute.call(this, method, path, handler, hook);
  };
  Object.defineProperty(application, "route", { value: undefined });
  Object.defineProperty(application, "method", { value: method });

  registerNativeRoute(application, "POST", "/candidate", (context: RouteContext) => context.body, {
    body: t.Object({ name: t.String() }),
  });

  const request = (name: unknown) =>
    new Request("http://localhost/candidate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
  const accepted = await application.handle(request("Aponia"));
  const rejected = await application.handle(request(42));

  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({ name: "Aponia" });
  expect(rejected.status).toBe(422);
});
