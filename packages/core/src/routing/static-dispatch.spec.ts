import { describe, expect, test } from "bun:test";
import { httpErrors, type CanActivate, type MountedRoute } from "@aponiajs/common";
import { compileStaticDispatchTable } from "./static-dispatch.ts";

function makeMount(
  method: "GET" | "POST" | "HEAD",
  path: string,
  handler: () => unknown,
  guards: readonly CanActivate[] = [],
): MountedRoute {
  const instance = { handle: handler };
  return {
    route: {
      method,
      path,
      propertyKey: "handle",
      parameters: [],
      declaredParameterCount: 0,
      pipes: [],
      enhancers: { guards: [], interceptors: [], filters: [] },
      schema: undefined,
      serializer: undefined,
    },
    controller: class {} as never,
    instance,
    guards,
    interceptors: [],
    filters: [],
    pipes: [],
  };
}

describe("compileStaticDispatchTable", () => {
  test("returns undefined when disabled or when interfering features are present", () => {
    const routes = [makeMount("GET", "/ping", () => ({ ok: true }))];
    expect(compileStaticDispatchTable(routes, { enabled: false })).toBeUndefined();
    expect(compileStaticDispatchTable(routes, { hasNativePlugins: true })).toBeUndefined();
    expect(compileStaticDispatchTable(routes, { hasMiddleware: true })).toBeUndefined();
    expect(compileStaticDispatchTable(routes, { hasHttpPolicies: true })).toBeUndefined();
    expect(compileStaticDispatchTable(routes, { hasRequestHooks: true })).toBeUndefined();
    expect(compileStaticDispatchTable(routes, { hasVersioning: true })).toBeUndefined();
    expect(compileStaticDispatchTable(routes, { hasRequestContext: true })).toBeUndefined();
    expect(compileStaticDispatchTable(routes, { hasStaticAssets: true })).toBeUndefined();
    expect(compileStaticDispatchTable(routes, { globalPipesCount: 1 })).toBeUndefined();
  });

  test("dispatches static GET, HEAD, string, binary, null, and Response values and populates bunRoutes", async () => {
    const routes = [
      makeMount("GET", "/json", () => ({ ok: true })),
      makeMount("GET", "/text", () => "hello"),
      makeMount("GET", "/bytes", () => new Uint8Array([1, 2, 3])),
      makeMount("GET", "/empty", () => null),
      makeMount("GET", "/native", () => new Response("custom", { status: 201 })),
      makeMount("HEAD", "/head-json", () => ({ ok: true })),
      makeMount("GET", "/shared", () => "get-shared"),
      makeMount("POST", "/shared", () => "post-shared"),
      makeMount("GET", "/users/:id", () => "dynamic"),
    ];

    const table = compileStaticDispatchTable(routes, {});
    expect(table).toBeDefined();

    const jsonRes = await table!.dispatch(new Request("http://localhost/json?x=1"))!;
    expect(jsonRes.status).toBe(200);
    expect(await jsonRes.json()).toEqual({ ok: true });
    expect(
      table!.dispatch(new Request("http://localhost/json", { method: "PUT" })),
    ).toBeUndefined();

    const textRes = await table!.dispatch(new Request("http://localhost/text"))!;
    expect(await textRes.text()).toBe("hello");
    expect(textRes.headers.get("content-type")).toContain("text/plain");

    const bytesRes = await table!.dispatch(new Request("http://localhost/bytes"))!;
    expect(new Uint8Array(await bytesRes.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const emptyRes = await table!.dispatch(new Request("http://localhost/empty"))!;
    expect(await emptyRes.text()).toBe("");

    const nativeRes = await table!.dispatch(new Request("http://localhost/native"))!;
    expect(nativeRes.status).toBe(201);
    expect(await nativeRes.text()).toBe("custom");

    const headRes = await table!.dispatch(
      new Request("http://localhost/head-json", { method: "HEAD" }),
    )!;
    expect(headRes.headers.get("content-type")).toContain("application/json");
    expect(await headRes.text()).toBe("");

    // Single-method GET routes are registered in bunRoutes; shared-path routes are excluded.
    expect(typeof table!.bunRoutes["/json"]).toBe("function");
    expect(table!.bunRoutes["/shared"]).toBeUndefined();
    expect(table!.bunRoutes["/users/:id"]).toBeUndefined();
    expect(table!.dispatch(new Request("http://localhost/users/1"))).toBeUndefined();
  });

  test("executes single and multi zero-arg guards (sync & async) and maps errors", async () => {
    const syncAllow: CanActivate = { canActivate: () => true };
    const syncDeny: CanActivate = { canActivate: () => false };
    const asyncAllow: CanActivate = { canActivate: async () => true };
    const asyncDeny: CanActivate = { canActivate: async () => false };
    const throwingGuard: CanActivate = {
      canActivate: () => {
        throw new Error("guard boom");
      },
    };
    const asyncThrowGuard: CanActivate = {
      canActivate: async () => {
        throw new Error("async guard boom");
      },
    };
    const argGuard: CanActivate = {
      canActivate: (_ctx) => true,
    };

    const routes = [
      makeMount("GET", "/g1-ok", () => "ok", [syncAllow]),
      makeMount("GET", "/g1-no", () => "no", [syncDeny]),
      makeMount("GET", "/g1-async-ok", () => "ok", [asyncAllow]),
      makeMount("GET", "/g1-async-no", () => "no", [asyncDeny]),
      makeMount("GET", "/g1-async-throw", () => "no", [asyncThrowGuard]),
      makeMount("GET", "/g2-ok", () => "ok", [syncAllow, asyncAllow]),
      makeMount("GET", "/g2-no", () => "no", [syncAllow, asyncDeny]),
      makeMount("GET", "/g2-async-throw", () => "no", [syncAllow, asyncThrowGuard]),
      makeMount("GET", "/g-throw", () => "no", [throwingGuard]),
      makeMount("GET", "/g2-throw", () => "no", [syncAllow, throwingGuard]),
      makeMount("GET", "/g-arg", () => "no", [argGuard]),
      makeMount("GET", "/with-arg", ((_x: unknown) => "no") as () => unknown),
      makeMount("GET", "/err-http", () => {
        throw httpErrors.badRequest("bad");
      }),
      makeMount("GET", "/err-to-resp", () => {
        throw { toResponse: () => new Response("custom-err", { status: 418 }) };
      }),
      makeMount("GET", "/err-on-err", () => {
        throw new Error("custom-handled");
      }),
      makeMount("GET", "/err-500", () => {
        throw new Error("unhandled");
      }),
      makeMount("GET", "/async-throw", async () => {
        throw new Error("async-unhandled");
      }),
    ];

    const table = compileStaticDispatchTable(routes, {
      logger: {
        log: () => {},
        warn: () => {},
        fatal: () => {},
        error: () => {
          throw new Error("logger failed");
        },
        debug: () => {},
        verbose: () => {},
      },
      onError: (err) =>
        err instanceof Error && err.message === "custom-handled"
          ? new Response("handled", { status: 422 })
          : undefined,
    })!;

    expect(await (await table.dispatch(new Request("http://localhost/g1-ok"))!).text()).toBe("ok");
    expect((await table.dispatch(new Request("http://localhost/g1-no"))!).status).toBe(403);
    expect(await (await table.dispatch(new Request("http://localhost/g1-async-ok"))!).text()).toBe(
      "ok",
    );
    expect((await table.dispatch(new Request("http://localhost/g1-async-no"))!).status).toBe(403);
    expect((await table.dispatch(new Request("http://localhost/g1-async-throw"))!).status).toBe(
      500,
    );
    expect(await (await table.dispatch(new Request("http://localhost/g2-ok"))!).text()).toBe("ok");
    expect((await table.dispatch(new Request("http://localhost/g2-no"))!).status).toBe(403);
    expect((await table.dispatch(new Request("http://localhost/g2-async-throw"))!).status).toBe(
      500,
    );
    expect((await table.dispatch(new Request("http://localhost/g-throw"))!).status).toBe(500);
    expect((await table.dispatch(new Request("http://localhost/g2-throw"))!).status).toBe(500);
    expect(table.dispatch(new Request("http://localhost/g-arg"))).toBeUndefined();
    expect(table.dispatch(new Request("http://localhost/with-arg"))).toBeUndefined();
    expect((await table.dispatch(new Request("http://localhost/err-http"))!).status).toBe(400);
    expect((await table.dispatch(new Request("http://localhost/err-to-resp"))!).status).toBe(418);
    expect((await table.dispatch(new Request("http://localhost/err-on-err"))!).status).toBe(422);
    expect((await table.dispatch(new Request("http://localhost/err-500"))!).status).toBe(500);
    expect((await table.dispatch(new Request("http://localhost/async-throw"))!).status).toBe(500);
  });
});
