import { describe, expect, test } from "bun:test";
import {
  notifyRequestError,
  notifyRequestResponse,
  provideRequestLifecycleHooks,
  runRequestHooks,
} from "../kernel/request-hooks.ts";
import { createBootDiagnosticsRef, readBootDiagnostics } from "./boot-diagnostics.ts";
import { createRequestPipeline } from "./request-pipeline.ts";

describe("request pipeline", () => {
  test("short-circuits when an onRequest hook returns a response and notifies onResponse", async () => {
    const events: string[] = [];
    const pipeline = createRequestPipeline({
      hooks: [
        {
          name: "block-hook",
          onRequest: () => {
            events.push("request");
            return new Response("blocked", { status: 403 });
          },
          onResponse: () => {
            events.push("response");
          },
        },
      ],
    });

    expect(pipeline).toBeDefined();
    const response = await pipeline!(new Request("http://localhost/"), () => {
      events.push("next");
      return new Response("ok");
    });

    expect(response.status).toBe(403);
    expect(events).toEqual(["request", "response"]);
  });

  test("notifies onError hooks and rethrows when the downstream handler rejects", async () => {
    const errors: unknown[] = [];
    const pipeline = createRequestPipeline({
      hooks: [
        {
          name: "error-hook",
          onError: (_request, error) => {
            errors.push(error);
          },
        },
      ],
    });

    expect(pipeline).toBeDefined();
    let thrown: unknown;
    try {
      await pipeline!(new Request("http://localhost/"), async () => {
        throw new Error("downstream failure");
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(errors).toEqual([thrown]);
  });
});

describe("boot diagnostics", () => {
  test("readBootDiagnostics returns undefined when the container has no diagnostics token", () => {
    const ref = createBootDiagnosticsRef();
    expect(ref.current).toBeUndefined();
    expect(
      readBootDiagnostics({
        get: () => {
          throw new Error("missing");
        },
      } as never),
    ).toBeUndefined();
  });
});

describe("request lifecycle hooks", () => {
  test("validates hook names and phases, skips absent phases, and isolates observer errors", async () => {
    const request = new Request("http://localhost/");
    const response = new Response("ok");
    const hooks = [
      {
        name: "only-request",
        onRequest: () => response,
      },
      {
        name: "throwing-observer",
        onResponse: () => {
          throw new Error("ignored");
        },
        onError: () => {
          throw new Error("ignored");
        },
      },
    ];

    expect(await runRequestHooks(hooks, request)).toBe(response);
    expect(await notifyRequestResponse(hooks, request, response)).toBeUndefined();
    expect(await notifyRequestError(hooks, request, new Error("boom"))).toBeUndefined();

    expect(() => provideRequestLifecycleHooks({ name: "  " })).toThrow(TypeError);
    expect(() => provideRequestLifecycleHooks({ name: "empty" })).toThrow(TypeError);
  });
});
