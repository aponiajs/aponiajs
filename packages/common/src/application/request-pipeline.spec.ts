import { describe, expect, test } from "bun:test";
import {
  notifyRequestError,
  notifyRequestResponse,
  provideRequestLifecycleHooks,
  runRequestHooks,
} from "../kernel/request-hooks.ts";
import { resolveApplicationHttpPolicies } from "../policy/http.policy.ts";
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

  test("covers sync header-only fast-path and pre-compiled wrap chain with preflight", async () => {
    const syncPipe = createRequestPipeline({
      policies: resolveApplicationHttpPolicies({ securityHeaders: true }),
      negotiator: (req) => (req.url.endsWith("/bad") ? new Response("bad", { status: 406 }) : req),
    })!;

    const badRes = await syncPipe(new Request("http://localhost/bad"), () => new Response("ok"));
    expect(badRes.status).toBe(406);
    expect(badRes.headers.get("x-content-type-options")).toBe("nosniff");

    const okRes = await syncPipe(new Request("http://localhost/ok"), () => new Response("ok"));
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get("x-content-type-options")).toBe("nosniff");

    const wrappedPipe = createRequestPipeline({
      policies: resolveApplicationHttpPolicies({ cors: true }),
      hooks: [
        { name: "wrap", wrap: (req, next) => next(req) },
        { name: "observer", onRequest: () => undefined },
      ],
    })!;
    const preflight = await wrappedPipe(
      new Request("http://localhost/", {
        method: "OPTIONS",
        headers: { origin: "https://app.test", "access-control-request-method": "GET" },
      }),
      () => new Response("never"),
    );
    expect(preflight.status).toBe(204);
  });
});
