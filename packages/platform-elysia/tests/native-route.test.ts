import { expect, test } from "bun:test";
import { AponiaError, type RouteContext } from "@aponiajs/common";
import { Elysia, t } from "elysia";
import { registerNativeRoute } from "../src/routing/native-route.ts";

function jsonRequest(payload: unknown): Request {
  return new Request("http://localhost/native", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function captureRegistrationFailure(application: Elysia): unknown {
  try {
    registerNativeRoute(application, "GET", "/native", () => "unreachable", undefined);
  } catch (error) {
    return error;
  }

  return undefined;
}

test("registers a route with the argument order Elysia 2 expects", () => {
  const calls: unknown[][] = [];
  const application = {
    method: (...arguments_: unknown[]) => {
      calls.push(arguments_);
    },
  } as unknown as Elysia;
  const handler = () => "pong";
  const hook = { body: t.Object({ hello: t.String() }) };

  registerNativeRoute(application, "POST", "/native", handler, hook);

  expect(calls).toEqual([["POST", "/native", hook, handler]]);
});

test("forwards the declared schema so a mounted route still validates", async () => {
  const application = new Elysia();
  registerNativeRoute(application, "POST", "/native", (context: RouteContext) => context.body, {
    body: t.Object({ hello: t.String() }),
  });

  const accepted = await application.handle(jsonRequest({ hello: "world" }));
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({ hello: "world" });

  const rejected = await application.handle(jsonRequest({ hello: 1 }));
  expect(rejected.status).toBe(422);
});

test("registers a route that declares no schema", async () => {
  const application = new Elysia();
  registerNativeRoute(application, "GET", "/native", () => "plain", undefined);

  const response = await application.handle(new Request("http://localhost/native"));

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("plain");
});

test("reports an Elysia build that no longer exposes method()", () => {
  const error = captureRegistrationFailure({} as Elysia);

  expect(error).toBeInstanceOf(AponiaError);
  expect(error).toEqual(
    expect.objectContaining({
      code: "UNSUPPORTED_ELYSIA_VERSION",
      details: { method: "GET", path: "/native", supported: "2.0.x" },
    }),
  );
});

test("freezes the details of an unrecognized Elysia failure", () => {
  const error = captureRegistrationFailure({} as Elysia) as AponiaError;

  expect(Object.isFrozen(error.details)).toBe(true);
});
