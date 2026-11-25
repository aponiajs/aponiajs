import type { CanActivate, RequestMethod, RouteContext } from "@aponiajs/common";
import {
  HttpError,
  StaticRouteExecutionContext,
  compileUnrolledGuards,
  createHttpKernel,
  createRouteMatcher,
  writeCookie,
} from "../src/index.ts";
import type { MountedRoute } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

function mount(
  method: RequestMethod,
  path: string,
  instance: Record<PropertyKey, unknown> = {},
): MountedRoute {
  return {
    route: {
      method,
      path,
      propertyKey: "handler",
      parameters: [],
      schema: undefined,
      declaredParameterCount: 0,
      pipes: [],
      enhancers: { guards: [], interceptors: [], filters: [] },
      serializer: undefined,
    },
    controller: class {},
    instance,
    guards: [],
    interceptors: [],
    filters: [],
    pipes: [],
  };
}

function requestContext(): RouteContext {
  return {
    body: undefined,
    query: {},
    params: {},
    headers: {},
    cookie: {},
    request: new Request("http://localhost/"),
    path: "/",
    set: { headers: {} },
  };
}

test("the Vite+ lane matches a route and percent-decodes its parameters", () => {
  const matcher = createRouteMatcher([mount("GET", "/files/:name")]);

  expect(matcher.match("get", "/files/a%20b")?.params).toEqual({ name: "a b" });
  expect(matcher.match("GET", "/files/caf%C3%A9")?.params).toEqual({ name: "café" });
  expect(matcher.match("GET", "/missing")).toBeUndefined();
});

test("the Vite+ lane keeps a path parameter whose percent escape is malformed", () => {
  const matcher = createRouteMatcher([mount("GET", "/files/:name")]);

  expect(matcher.match("GET", "/files/100%zz")?.params).toEqual({ name: "100%zz" });
});

test("the Vite+ lane returns a frozen match around the mounted route", () => {
  const matcher = createRouteMatcher([mount("GET", "/health")]);
  const match = matcher.match("GET", "/health");

  expect(match?.mount.route.path).toBe("/health");
  expect(Object.isFrozen(match)).toBe(true);
  expect(Object.isFrozen(match?.params)).toBe(true);
});

test("the Vite+ lane maps an unhandled failure to a 500 problem document without its cause", async () => {
  const kernel = createHttpKernel({
    routes: [
      mount("GET", "/boom", {
        handler: () => {
          throw new Error("exploded");
        },
      }),
    ],
  });
  const response = await kernel.handle(new Request("http://localhost/boom"));
  const text = await response.text();

  expect(response.status).toBe(500);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  expect(text).not.toContain("exploded");
  expect((JSON.parse(text) as { readonly code: string }).code).toBe("INTERNAL_SERVER_ERROR");
});

test("the Vite+ lane answers an unmatched request with a 404 problem document", async () => {
  const kernel = createHttpKernel({ routes: [] });
  const response = await kernel.handle(new Request("http://localhost/missing"));

  expect(response.status).toBe(404);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  const body = (await response.json()) as { readonly code: string };
  expect(body.code).toBe("ROUTE_NOT_FOUND");
});

test("the Vite+ lane lets an HttpError answer with its own problem document", async () => {
  const kernel = createHttpKernel({
    routes: [
      mount("GET", "/denied", {
        handler: () => {
          throw new HttpError("Forbidden", { code: "ACCESS_DENIED" });
        },
      }),
    ],
  });
  const response = await kernel.handle(new Request("http://localhost/denied"));

  expect(response.status).toBe(403);
  const body = (await response.json()) as { readonly code: string };
  expect(body.code).toBe("ACCESS_DENIED");
});

test("the Vite+ lane keeps each written cookie as its own set-cookie header on a failure answer", async () => {
  const kernel = createHttpKernel({
    routes: [mount("GET", "/cookies")],
    middleware: async (context) => {
      writeCookie(context.set, "first", "1", { httpOnly: true });
      writeCookie(context.set, "second", "2");
      throw new Error("failed after writing cookies");
    },
  });
  const response = await kernel.handle(new Request("http://localhost/cookies"));

  expect(response.status).toBe(500);
  expect(response.headers.getSetCookie()).toEqual(["first=1; HttpOnly", "second=2"]);
});

test("the Vite+ lane keeps each route-declared set-cookie value as its own header", async () => {
  const base = mount("GET", "/cookies", { handler: () => "ok" });
  const kernel = createHttpKernel({
    routes: [
      { ...base, route: { ...base.route, responseHeaders: { "set-cookie": ["a=1", "b=2"] } } },
    ],
  });
  const response = await kernel.handle(new Request("http://localhost/cookies"));

  expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
});

test("the Vite+ lane runs guards in declaration order and stops at the first refusal", async () => {
  const calls: string[] = [];
  const context = requestContext();
  const execContext = new StaticRouteExecutionContext({}, () => undefined);
  const guards: readonly CanActivate[] = [
    {
      canActivate: (host) => {
        expect(host.getContext()).toBe(context);
        calls.push("first");
        return true;
      },
    },
    {
      canActivate: async () => {
        calls.push("second");
        return false;
      },
    },
    {
      canActivate: () => {
        calls.push("third");
        return true;
      },
    },
  ];
  const hook = compileUnrolledGuards(guards, execContext, "forbidden");

  expect(hook).toBeDefined();
  const answer = await hook!(context);

  expect(answer).toBe("forbidden");
  expect(calls).toEqual(["first", "second"]);
  expect(context.set.status).toBe(403);
  expect(context.set.headers["content-type"]).toBe("application/problem+json");
});

test("the Vite+ lane runs every allowing guard and leaves the answer untouched", () => {
  const calls: number[] = [];
  const context = requestContext();
  const execContext = new StaticRouteExecutionContext({}, () => undefined);
  const hook = compileUnrolledGuards(
    [
      {
        canActivate: () => {
          calls.push(1);
          return true;
        },
      },
      {
        canActivate: () => {
          calls.push(2);
          return true;
        },
      },
    ],
    execContext,
    "forbidden",
  );

  expect(hook!(context)).toBeUndefined();
  expect(calls).toEqual([1, 2]);
  expect(context.set.status).toBeUndefined();
  expect(context.set.headers).toEqual({});
});
