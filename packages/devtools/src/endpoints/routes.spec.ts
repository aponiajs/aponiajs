import { expect, test } from "bun:test";
import type { AponiaBootDiagnostics, CompiledRoute } from "@aponiajs/common";
import type { AponiaRoutesPayload } from "../index.ts";
import { buildRoutesPayload } from "./routes.ts";

/**
 * `/routes` is projected from the neutral boot record rather than from a native
 * route table, so these cases build the record itself. Each case asserts the
 * published wire shape: the plan's fields, the callback route's stated
 * absence of a handler, the dedupe between the two sources, and the ordering
 * rule a consumer relies on.
 */

function route(overrides: Partial<CompiledRoute> = {}): CompiledRoute {
  return {
    method: "GET",
    path: "/alpha",
    propertyKey: "read",
    parameters: [],
    schema: undefined,
    declaredParameterCount: 0,
    pipes: [],
    enhancers: { guards: [], interceptors: [], filters: [] },
    serializer: undefined,
    ...overrides,
  };
}

function diagnostics(overrides: Partial<AponiaBootDiagnostics> = {}): AponiaBootDiagnostics {
  return {
    framework: "1.0.0-test",
    graph: "decorated",
    rootModule: undefined,
    modules: [],
    routes: [],
    callbackRoutes: [],
    globalEnhancers: { guards: [], interceptors: [], filters: [] },
    interceptorHalves: new Map(),
    artifacts: null,
    invokers: null,
    mappedExceptions: null,
    ...overrides,
  };
}

test("routes answers an empty list when no boot record exists", () => {
  expect(buildRoutesPayload(undefined)).toEqual({ routes: [] });
});

test("routes publishes a compiled plan with its module, controller, handler, and parameters", () => {
  const payload = buildRoutesPayload(
    diagnostics({
      routes: [
        {
          module: "UsersModule",
          controller: "UsersController",
          source: "generated",
          route: route({
            method: "POST",
            path: "/users",
            propertyKey: "create",
            parameters: [
              { index: 0, kind: "body" },
              { index: 1, kind: "query", property: "verbose" },
            ],
          }),
        },
      ],
    }),
  );

  expect(payload).toEqual({
    routes: [
      {
        method: "POST",
        path: "/users",
        module: "UsersModule",
        controller: "UsersController",
        handler: "create",
        source: "generated",
        parameters: [
          { index: 0, kind: "body", property: undefined },
          { index: 1, kind: "query", property: "verbose" },
        ],
      },
    ],
  });
});

test("routes projects a symbol handler key the way the platform states it", () => {
  const payload = buildRoutesPayload(
    diagnostics({
      routes: [
        {
          module: "M",
          controller: "C",
          source: "compiled",
          route: route({ propertyKey: Symbol("read") }),
        },
      ],
    }),
  );

  expect(payload.routes[0]?.handler).toBe("Symbol(read)");
  expect(payload.routes[0]?.source).toBe("compiled");
});

test("routes drops parameter entries this release cannot read and keeps the rest of the list", () => {
  const payload = buildRoutesPayload(
    diagnostics({
      routes: [
        {
          module: "M",
          controller: "C",
          source: "compiled",
          route: route({
            parameters: [
              { index: 0, kind: "body" },
              { index: "1", kind: "body" },
              { index: 2, kind: "not-a-kind" },
              null,
              "nope",
              { index: 3, kind: "store", property: "user" },
            ] as never,
          }),
        },
      ],
    }),
  );

  expect(payload.routes[0]?.parameters).toEqual([
    { index: 0, kind: "body", property: undefined },
    { index: 3, kind: "store", property: "user" },
  ]);
});

test("routes reports a callback route with no handler and no parameters", () => {
  const payload = buildRoutesPayload(
    diagnostics({
      callbackRoutes: [
        {
          module: "FilesModule",
          controller: "FilesController",
          source: "compiled",
          method: "GET",
          path: "/files/:id",
        },
      ],
    }),
  );

  expect(payload).toEqual({
    routes: [
      {
        method: "GET",
        path: "/files/:id",
        module: "FilesModule",
        controller: "FilesController",
        handler: "",
        source: "compiled",
        parameters: [],
      },
    ],
  });
});

test("routes keeps the compiled plan when a callback mounts the same method and path", () => {
  const payload = buildRoutesPayload(
    diagnostics({
      routes: [
        {
          module: "M",
          controller: "C",
          source: "generated",
          route: route({ method: "POST", path: "/same", propertyKey: "create" }),
        },
      ],
      callbackRoutes: [
        { module: "M", controller: "C", source: "compiled", method: "POST", path: "/same" },
      ],
    }),
  );

  expect(payload.routes).toHaveLength(1);
  expect(payload.routes[0]?.handler).toBe("create");
  expect(payload.routes[0]?.source).toBe("generated");
});

test("routes orders entries by path, method, controller, handler, and module", () => {
  const payload: AponiaRoutesPayload = buildRoutesPayload(
    diagnostics({
      routes: [
        {
          module: "Z",
          controller: "C",
          source: "compiled",
          route: route({ method: "GET", path: "/b", propertyKey: "b" }),
        },
        {
          module: "A",
          controller: "C",
          source: "compiled",
          route: route({ method: "GET", path: "/a", propertyKey: "z" }),
        },
        {
          module: "A",
          controller: "B",
          source: "compiled",
          route: route({ method: "POST", path: "/a", propertyKey: "p" }),
        },
        {
          module: "A",
          controller: "A",
          source: "compiled",
          route: route({ method: "GET", path: "/c", propertyKey: "a" }),
        },
      ],
    }),
  );

  expect(
    payload.routes.map(
      (entry) => `${entry.method} ${entry.path} ${entry.controller}${entry.handler}`,
    ),
  ).toEqual(["GET /a Cz", "POST /a Bp", "GET /b Cb", "GET /c Aa"]);
});

test("routes keeps the last plan recorded for one method and path", () => {
  const payload = buildRoutesPayload(
    diagnostics({
      routes: [
        {
          module: "M",
          controller: "C",
          source: "compiled",
          route: route({ path: "/same", propertyKey: "first" }),
        },
        {
          module: "M",
          controller: "C",
          source: "compiled",
          route: route({ path: "/same", propertyKey: "second" }),
        },
      ],
    }),
  );

  expect(payload.routes).toHaveLength(1);
  expect(payload.routes[0]?.handler).toBe("second");
});

test("routes reports an empty handler for a plan that states no property key", () => {
  const payload = buildRoutesPayload(
    diagnostics({
      routes: [
        {
          module: "M",
          controller: "C",
          source: "compiled",
          route: route({ propertyKey: undefined as never }),
        },
      ],
    }),
  );

  expect(payload.routes[0]?.handler).toBe("");
});
