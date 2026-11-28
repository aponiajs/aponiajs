import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  compileSlotValidator,
  type ArgumentMetadata,
  type CanActivate,
  type MountedRoute,
  type PipeTransform,
  type PlatformRouteContext,
} from "@aponiajs/common";
import Type from "typebox";
import {
  compileMiddlewareConfigs,
  runCompiledMiddlewareChain,
} from "../middleware/route-matching.ts";
import { executePipesSyncOrAsync, resolvePipe } from "../pipes/pipe.resolver.ts";
import { buildCompiledArguments, compileParameterPlan } from "../kernel/parameter-binding.ts";
import { createRouteHandler, decodeRouteRequest } from "./route-handler.ts";

describe("fast-path core helpers", () => {
  test("executePipesSyncOrAsync handles empty, sync, and async pipes", async () => {
    const meta: ArgumentMetadata = { type: "query", data: "x" };
    expect(executePipesSyncOrAsync([], "a", meta)).toBe("a");

    const syncPipe: PipeTransform<unknown, unknown> = {
      transform: (v) => `${String(v)}-s`,
    };
    const asyncPipe: PipeTransform<unknown, unknown> = {
      transform: async (v) => `${String(v)}-a`,
    };
    const pSync = resolvePipe(syncPipe);
    const pAsync = resolvePipe(asyncPipe);

    expect(executePipesSyncOrAsync([pSync], "v", meta)).toBe("v-s");
    expect(await executePipesSyncOrAsync([pSync, pAsync, pSync], "v", meta)).toBe("v-s-a-s");
  });

  test("compileParameterPlan and buildCompiledArguments handle sparse and async piped params", async () => {
    const asyncPipe: PipeTransform<unknown, unknown> = {
      transform: async (v) => Number(v) * 2,
    };
    const plan = compileParameterPlan(
      [
        { index: 1, kind: "query", property: "n", pipes: [asyncPipe] },
        { index: 2, kind: "host" },
      ],
      [],
      [],
      undefined,
      3,
    );
    const args = await buildCompiledArguments(plan, {
      request: new Request("http://example.com/items?n=5"),
      path: "/items",
      body: undefined,
      query: { n: "5" },
      params: {},
      headers: {},
      cookie: {},
      ip: "127.0.0.1",
      host: "example.com",
      store: {},
      set: { headers: {} },
      status: () => new Response(null),
    });
    expect(args).toEqual([undefined, 10, "example.com"]);
  });

  test("compileMiddlewareConfigs and runCompiledMiddlewareChain match object, param, wildcard, and excluded rules", async () => {
    @Controller("users")
    class UsersController {}

    const calls: string[] = [];
    const compiled = compileMiddlewareConfigs([
      {
        middleware: [
          {
            use: async (_ctx: unknown, next: () => Promise<unknown>) => {
              calls.push("mw");
              return await next();
            },
          },
        ],
        targets: [UsersController, { path: "/orders/:id", method: "POST" }, { path: "/assets/*" }],
        excluded: ["/users/skip", { path: "/orders/:id", method: "DELETE" }],
      },
    ]);

    await runCompiledMiddlewareChain(compiled, {}, "/users/list", "GET", async () => "ok");
    await runCompiledMiddlewareChain(compiled, {}, "/users/skip", "GET", async () => "ok");
    await runCompiledMiddlewareChain(compiled, {}, "/orders/42", "POST", async () => "ok");
    await runCompiledMiddlewareChain(compiled, {}, "/orders/42", "DELETE", async () => "ok");
    await runCompiledMiddlewareChain(compiled, {}, "/assets/a/b", "GET", async () => "ok");
    await runCompiledMiddlewareChain(compiled, {}, "/other", "GET", async () => "ok");

    expect(calls).toEqual(["mw", "mw", "mw"]);
  });

  test("createRouteHandler fast route handles async guards, async handlers, and guard/handler throws", async () => {
    @Controller("fast")
    class FastController {
      @Get("async")
      async asyncRoute() {
        return { ok: true };
      }

      @Get("fail")
      failRoute() {
        throw new Error("boom");
      }
    }

    const instance = new FastController();
    const asyncGuard: CanActivate = { canActivate: async () => true };
    const denyAsyncGuard: CanActivate = { canActivate: async () => false };
    const throwGuard: CanActivate = {
      canActivate: async () => {
        throw new Error("guard fail");
      },
    };

    const makeMount = (propertyKey: string, guards: readonly CanActivate[]): MountedRoute => ({
      route: {
        method: "GET",
        path: `/${propertyKey}`,
        propertyKey,
        parameters: [],
        declaredParameterCount: 0,
        pipes: [],
        enhancers: { guards: [], interceptors: [], filters: [] },
        schema: undefined,
        serializer: undefined,
      },
      controller: FastController as never,
      instance,
      guards,
      interceptors: [],
      filters: [],
      pipes: [],
    });

    const ctx = {
      request: new Request("http://localhost/fast/async"),
      path: "/fast/async",
      body: undefined,
      query: {},
      params: {},
      headers: {},
      cookie: {},
      ip: undefined,
      host: "localhost",
      store: {},
      set: { headers: {} },
      status: (code: number, body?: unknown) => Response.json(body, { status: code }),
    } as unknown as PlatformRouteContext;

    const okHandler = createRouteHandler(makeMount("asyncRoute", [asyncGuard]), { routes: [] });
    expect((await okHandler(ctx)).status).toBe(200);

    const denyHandler = createRouteHandler(makeMount("asyncRoute", [denyAsyncGuard]), {
      routes: [],
    });
    expect((await denyHandler(ctx)).status).toBe(403);

    const throwGuardHandler = createRouteHandler(makeMount("asyncRoute", [throwGuard]), {
      routes: [],
    });
    expect((await throwGuardHandler(ctx)).status).toBe(500);

    const failHandler = createRouteHandler(makeMount("failRoute", []), { routes: [] });
    expect((await failHandler(ctx)).status).toBe(500);
  });

  test("createRouteHandler full-enhancer path decodes body, query, params, headers, and cookie schemas", async () => {
    const schemaValidator = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: (v: unknown) => ({ value: v }),
      },
    };

    const controller = class TestSchemaController {
      handle(ctx: PlatformRouteContext) {
        return {
          body: ctx.body,
          query: ctx.query,
          params: ctx.params,
          headers: ctx.headers,
          cookie: ctx.cookie,
        };
      }
    };
    const instance = new controller();
    const mount: MountedRoute = {
      route: {
        method: "POST",
        path: "/items/:id",
        propertyKey: "handle",
        parameters: [],
        declaredParameterCount: 1,
        pipes: [],
        enhancers: { guards: [], interceptors: [], filters: [] },
        schema: {
          body: schemaValidator,
          query: schemaValidator,
          params: schemaValidator,
          headers: schemaValidator,
          cookie: schemaValidator,
        },
        serializer: undefined,
      },
      controller: controller as never,
      instance,
      guards: [],
      interceptors: [
        {
          interceptBefore: () => {},
        },
      ],
      filters: [],
      pipes: [],
    };

    const handler = createRouteHandler(mount, { routes: [mount] });
    const req = new Request("http://localhost/items/42?tag=a", {
      method: "POST",
      headers: { "content-type": "application/json", "x-custom": "1", cookie: "c=9" },
      body: JSON.stringify({ name: "item" }),
    });
    const res = await handler({
      request: req,
      path: "/items/42",
      body: undefined,
      query: { tag: "a" },
      params: { id: "42" },
      headers: { "x-custom": "1" },
      cookie: { c: { value: "9" } },
      ip: "127.0.0.1",
      host: "localhost",
      store: {},
      set: { headers: {} },
      status: (code: number, body?: unknown) => Response.json(body, { status: code }),
    } as unknown as PlatformRouteContext);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      body: { name: "item" },
      query: { tag: "a" },
      params: { id: "42" },
      headers: { "x-custom": "1" },
      cookie: { c: { value: "9" } },
    });
  });

  test("createRouteHandler handles async schema validators, full-enhancer guard refusal, and SSE streams", async () => {
    const asyncSchema = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: async (v: unknown) => ({ value: v }),
      },
    };

    const controller = class AsyncAndSseController {
      handle(ctx: PlatformRouteContext) {
        return { q: ctx.query, p: ctx.params, h: ctx.headers, c: ctx.cookie };
      }

      async *stream() {
        yield { data: "one" };
        yield "two";
      }
    };
    const instance = new controller();
    const mount: MountedRoute = {
      route: {
        method: "GET",
        path: "/async-schema/:id",
        propertyKey: "handle",
        parameters: [],
        declaredParameterCount: 1,
        pipes: [],
        enhancers: { guards: [], interceptors: [], filters: [] },
        schema: {
          query: asyncSchema,
          params: asyncSchema,
          headers: asyncSchema,
          cookie: asyncSchema,
        },
        serializer: undefined,
      },
      controller: controller as never,
      instance,
      guards: [],
      interceptors: [{ interceptBefore: async () => {} }],
      filters: [],
      pipes: [],
    };
    const handler = createRouteHandler(mount, { routes: [mount] });
    const ctx = {
      request: new Request("http://localhost/async-schema/1?a=1"),
      path: "/async-schema/1",
      body: undefined,
      query: { a: "1" },
      params: { id: "1" },
      headers: { h: "1" },
      cookie: { k: { value: "v" } },
      ip: undefined,
      host: "localhost",
      store: {},
      set: { headers: {} },
      status: (code: number, body?: unknown) => Response.json(body, { status: code }),
    } as unknown as PlatformRouteContext;
    expect((await handler(ctx)).status).toBe(200);

    const denyMount: MountedRoute = {
      ...mount,
      guards: [{ canActivate: async () => false }],
    };
    expect((await createRouteHandler(denyMount, { routes: [denyMount] })(ctx)).status).toBe(403);

    const sseMount: MountedRoute = {
      ...mount,
      route: {
        ...mount.route,
        propertyKey: "stream",
        schema: undefined,
        sse: true,
      },
      interceptors: [],
    };
    const sseRes = await createRouteHandler(sseMount, { routes: [sseMount] })(ctx);
    expect(sseRes.headers.get("content-type")).toContain("text/event-stream");
    const sseText = await sseRes.text();
    expect(sseText).toContain("data:");

    // Fast route with async pipe parameter + decodeRouteRequest without precompiled execution
    const asyncPipeMount: MountedRoute = {
      ...mount,
      route: {
        ...mount.route,
        method: "POST",
        path: "/piped",
        propertyKey: "handle",
        parameters: [
          {
            index: 0,
            kind: "query",
            property: "a",
            pipes: [{ transform: async (v: unknown) => v }],
          },
        ],
        schema: undefined,
      },
      interceptors: [],
    };
    const asyncPipeRes = await createRouteHandler(asyncPipeMount, { routes: [asyncPipeMount] })({
      ...ctx,
      set: { headers: {} },
    } as unknown as PlatformRouteContext);
    expect(asyncPipeRes.status).toBe(200);

    await decodeRouteRequest(mount, ctx, {
      store: {},
      globalPipes: [],
      maxBodyBytes: 1024,
      renderView: undefined,
      logger: undefined,
      requestHooks: [],
    });

    // Response with immutable headers + array responseHeaders hits withSettingsHeaders clone fallback
    const redirectMount: MountedRoute = {
      ...mount,
      route: {
        ...mount.route,
        propertyKey: "redirect",
        schema: undefined,
        responseHeaders: { "x-multi": ["a", "b"] },
      },
      interceptors: [],
      instance: {
        redirect: (c: PlatformRouteContext) => {
          c.set.headers["x-arr"] = ["1", "2"];
          c.set.headers["x-undef"] = undefined;
          const res = new Response("redir", { status: 302 });
          Object.defineProperty(res.headers, "set", {
            value: () => {
              throw new TypeError("immutable");
            },
          });
          Object.defineProperty(res.headers, "append", {
            value: () => {
              throw new TypeError("immutable");
            },
          });
          return res;
        },
      },
    };
    const redirRes = await createRouteHandler(redirectMount, { routes: [redirectMount] })({
      ...ctx,
      set: { headers: {} },
    } as unknown as PlatformRouteContext);
    expect(redirRes.status).toBe(302);
    expect(redirRes.headers.get("x-arr")).toBe("1, 2");

    // Async handler rejection + async pipe rejection + missing handler + serializer
    const rejectAsyncMount: MountedRoute = {
      ...mount,
      route: { ...mount.route, propertyKey: "boomAsync", schema: undefined },
      interceptors: [],
      instance: {
        boomAsync: async () => {
          throw new Error("async boom");
        },
      },
    };
    expect(
      (
        await createRouteHandler(rejectAsyncMount, { routes: [rejectAsyncMount] })({
          ...ctx,
          set: { headers: {} },
        } as unknown as PlatformRouteContext)
      ).status,
    ).toBe(500);

    const rejectPipeMount: MountedRoute = {
      ...mount,
      route: {
        ...mount.route,
        propertyKey: "handle",
        schema: undefined,
        parameters: [
          {
            index: 0,
            kind: "query",
            property: "a",
            pipes: [
              {
                transform: async () => {
                  throw new Error("pipe boom");
                },
              },
            ],
          },
        ],
      },
      interceptors: [],
    };
    expect(
      (
        await createRouteHandler(rejectPipeMount, { routes: [rejectPipeMount] })({
          ...ctx,
          set: { headers: {} },
        } as unknown as PlatformRouteContext)
      ).status,
    ).toBe(500);

    const missingHandlerMount: MountedRoute = {
      ...mount,
      route: {
        ...mount.route,
        propertyKey: "doesNotExist",
        schema: undefined,
        serializer: (v) => ({ serialized: v }),
      },
      guards: [{ canActivate: () => true }],
    };
    expect(
      (
        await createRouteHandler(missingHandlerMount, { routes: [missingHandlerMount] })({
          ...ctx,
          set: { headers: {} },
        } as unknown as PlatformRouteContext)
      ).status,
    ).toBe(500);

    // Sync guard throw on fast route
    const syncThrowGuardMount: MountedRoute = {
      ...mount,
      route: { ...mount.route, schema: undefined },
      interceptors: [],
      guards: [
        {
          canActivate: () => {
            throw new Error("sync guard throw");
          },
        },
      ],
    };
    expect(
      (
        await createRouteHandler(syncThrowGuardMount, { routes: [syncThrowGuardMount] })({
          ...ctx,
          set: { headers: {} },
        } as unknown as PlatformRouteContext)
      ).status,
    ).toBe(500);

    // Sync generator SSE + middleware returning Response synchronously
    const syncSseMount: MountedRoute = {
      ...mount,
      route: { ...mount.route, propertyKey: "syncStream", schema: undefined, sse: true },
      interceptors: [],
      instance: {
        async *syncStream() {
          yield { data: "sync-event" };
        },
      },
    };
    const syncSseRes = await createRouteHandler(syncSseMount, { routes: [syncSseMount] })({
      ...ctx,
      set: { headers: {} },
    } as unknown as PlatformRouteContext);
    expect(syncSseRes.headers.get("content-type")).toContain("text/event-stream");
    expect(await syncSseRes.text()).toContain("sync-event");

    const syncMwCompiled = compileMiddlewareConfigs([
      {
        middleware: [
          {
            use: () => new Response("short-circuit", { status: 401 }),
          },
        ],
        targets: ["*"],
        excluded: [],
      },
    ]);
    const mwRes = await runCompiledMiddlewareChain(
      syncMwCompiled,
      {},
      "/any",
      "GET",
      async () => "next",
    );
    expect((mwRes as Response).status).toBe(401);

    // Zero-arg async rejecting guard on fast route + view missing error + requestHooks onError
    const zeroArgRejectGuardMount: MountedRoute = {
      ...mount,
      route: { ...mount.route, schema: undefined },
      interceptors: [],
      guards: [{ canActivate: () => Promise.reject(new Error("zero-arg async reject")) }],
    };
    expect(
      (
        await createRouteHandler(zeroArgRejectGuardMount, {
          routes: [zeroArgRejectGuardMount],
          requestHooks: [{ name: "test-hook", onError: () => {} }],
        })({ ...ctx, set: { headers: {} } } as unknown as PlatformRouteContext)
      ).status,
    ).toBe(500);

    const viewMissingMount: MountedRoute = {
      ...mount,
      route: {
        ...mount.route,
        schema: undefined,
        view: { template: "missing.html" },
      },
      interceptors: [],
    };
    expect(
      (
        await createRouteHandler(viewMissingMount, { routes: [viewMissingMount] })({
          ...ctx,
          set: { headers: {} },
        } as unknown as PlatformRouteContext)
      ).status,
    ).toBe(500);

    // decodeRouteRequest without body decoding
    await decodeRouteRequest(
      {
        ...mount,
        route: { ...mount.route, method: "GET", parameters: [], schema: { query: asyncSchema } },
      },
      ctx,
      {
        store: {},
        globalPipes: [],
        maxBodyBytes: 1024,
        renderView: undefined,
        logger: undefined,
        requestHooks: [],
      },
    );

    // compileSlotValidator with TypeBox coercion + invalid input
    const tbSchema = Type.Object({ n: Type.Number() });
    const tbValidator = compileSlotValidator(tbSchema, "query", true)!;
    expect(tbValidator({ n: "42" })).toEqual({ n: 42 });
    let tbFailed = false;
    try {
      tbValidator({ n: "not-a-number" });
    } catch {
      tbFailed = true;
    }
    expect(tbFailed).toBe(true);

    const tbNoCoerce = compileSlotValidator(tbSchema, "body", false)!;
    expect(tbNoCoerce({ n: 7 })).toEqual({ n: 7 });
    let tbNoCoerceFailed = false;
    try {
      tbNoCoerce({ n: "7" });
    } catch {
      tbNoCoerceFailed = true;
    }
    expect(tbNoCoerceFailed).toBe(true);

    // Fast route with httpCode + responseHeaders + custom filter
    const settingsAndFilterMount: MountedRoute = {
      ...mount,
      route: {
        ...mount.route,
        schema: undefined,
        httpCode: 201,
        responseHeaders: { "x-static-hdr": "yes" },
      },
      interceptors: [],
      filters: [
        {
          instance: { catch: () => new Response("filtered", { status: 418 }) },
          exceptions: [Error],
        },
      ],
      instance: {
        handle: () => ({ ok: true }),
      },
    };
    const settingsRes = await createRouteHandler(settingsAndFilterMount, {
      routes: [settingsAndFilterMount],
    })({ ...ctx, set: { headers: {} } } as unknown as PlatformRouteContext);
    expect(settingsRes.status).toBe(201);
    expect(settingsRes.headers.get("x-static-hdr")).toBe("yes");

    const filteredMount: MountedRoute = {
      ...settingsAndFilterMount,
      instance: {
        handle: () => {
          throw new Error("filter me");
        },
      },
    };
    const filteredRes = await createRouteHandler(filteredMount, {
      routes: [filteredMount],
    })({ ...ctx, set: { headers: {} } } as unknown as PlatformRouteContext);
    expect(filteredRes.status).toBe(418);

    // Fast route with async query schema (resolving + rejecting)
    const fastAsyncSchemaMount: MountedRoute = {
      ...mount,
      route: { ...mount.route, schema: { query: asyncSchema } },
      interceptors: [],
    };
    expect(
      (
        await createRouteHandler(fastAsyncSchemaMount, {
          routes: [fastAsyncSchemaMount],
        })({ ...ctx, set: { headers: {} } } as unknown as PlatformRouteContext)
      ).status,
    ).toBe(200);

    const fastAsyncFailSchemaMount: MountedRoute = {
      ...mount,
      route: {
        ...mount.route,
        schema: {
          query: {
            "~standard": {
              version: 1 as const,
              vendor: "test",
              validate: async () => ({ issues: [{ message: "bad" }] }),
            },
          },
        },
      },
      interceptors: [],
    };
    expect(
      (
        await createRouteHandler(fastAsyncFailSchemaMount, {
          routes: [fastAsyncFailSchemaMount],
        })({ ...ctx, set: { headers: {} } } as unknown as PlatformRouteContext)
      ).status,
    ).toBe(422);
  });
});
