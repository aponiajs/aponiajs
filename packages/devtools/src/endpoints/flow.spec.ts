import { expect, test } from "bun:test";
import { Catch, Validation } from "@aponiajs/common";
import type { AponiaBootDiagnostics, CompiledRoute } from "@aponiajs/common";
import { buildFlowPayload } from "./flow.ts";

/**
 * `/flow` states the chain each recorded route passes through. These cases
 * build the neutral record the endpoint projects and assert the published
 * stages: their kinds, their order, their scope, the explicit `next` links that
 * make the payload a graph, and the filters that answer a throw. They also pin
 * the endpoint's documented degradations — a contributed native hook is never a
 * stage, and a route no plan describes publishes only what the callback states.
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

class GlobalGuard {}
class LocalGuard {}
class GlobalFilter {}

class BothInterceptor {
  interceptBefore(): void {}
  interceptAfter(): void {}
}

class BeforeInterceptor {
  interceptBefore(): void {}
}

class AfterInterceptor {
  interceptAfter(): void {}
}

class RecordedBeforeInterceptor {}

class EmptyInterceptor {}

@Catch(Error)
class CatchesErrorFilter {}

@Catch()
class CatchAllFilter {}

@Validation({ "~kind": "Object" } as never)
class CreateUser {}

class RawQuery {}

test("flow answers an empty route list when no boot record exists", () => {
  expect(buildFlowPayload(undefined)).toEqual({ routes: [] });
});

test("flow publishes validation, guards, interceptor halves, binding, invoke, and handler in run order", () => {
  const halves = new Map([
    [BothInterceptor, { before: false, after: true }],
    [RecordedBeforeInterceptor, { before: true, after: false }],
  ]);

  const payload = buildFlowPayload(
    diagnostics({
      globalEnhancers: {
        guards: [GlobalGuard],
        interceptors: [BothInterceptor, RecordedBeforeInterceptor, EmptyInterceptor],
        filters: [GlobalFilter],
      },
      interceptorHalves: halves,
      routes: [
        {
          module: "UsersModule",
          controller: "UsersController",
          source: "compiled",
          route: route({
            method: "POST",
            path: "/users",
            propertyKey: "create",
            schema: { body: CreateUser, query: RawQuery } as never,
            parameters: [
              { index: 0, kind: "body" },
              { index: 1, kind: "query", property: "verbose" },
            ],
            enhancers: {
              guards: [LocalGuard],
              interceptors: [BeforeInterceptor, AfterInterceptor],
              filters: [CatchesErrorFilter, CatchAllFilter],
            },
          }),
        },
      ],
    }),
  );

  expect(payload.routes).toHaveLength(1);
  const trace = payload.routes[0]!;

  expect(trace.id).toBe("POST /users");
  expect(trace.stages.map((stage) => stage.kind)).toEqual([
    "validate",
    "validate",
    "guard",
    "guard",
    "interceptBefore",
    "interceptBefore",
    "bind",
    "invoke",
    "handler",
    "interceptAfter",
    "interceptAfter",
  ]);

  expect(trace.stages.map((stage) => ({ ...stage }))).toEqual([
    {
      id: "POST /users#0",
      kind: "validate",
      slot: "body",
      model: "CreateUser",
      next: ["POST /users#1"],
    },
    {
      id: "POST /users#1",
      kind: "validate",
      slot: "query",
      next: ["POST /users#2"],
    },
    {
      id: "POST /users#2",
      kind: "guard",
      scope: "global",
      enhancer: "GlobalGuard",
      next: ["POST /users#3"],
    },
    {
      id: "POST /users#3",
      kind: "guard",
      scope: "local",
      enhancer: "LocalGuard",
      next: ["POST /users#4"],
    },
    {
      id: "POST /users#4",
      kind: "interceptBefore",
      scope: "global",
      enhancer: "RecordedBeforeInterceptor",
      next: ["POST /users#5"],
    },
    {
      id: "POST /users#5",
      kind: "interceptBefore",
      scope: "local",
      enhancer: "BeforeInterceptor",
      next: ["POST /users#6"],
    },
    {
      id: "POST /users#6",
      kind: "bind",
      parameters: [
        { index: 0, kind: "body", property: undefined },
        { index: 1, kind: "query", property: "verbose" },
      ],
      next: ["POST /users#7"],
    },
    {
      id: "POST /users#7",
      kind: "invoke",
      source: "compiled",
      next: ["POST /users#8"],
    },
    {
      id: "POST /users#8",
      kind: "handler",
      handler: "create",
      next: ["POST /users#9"],
    },
    {
      id: "POST /users#9",
      kind: "interceptAfter",
      scope: "local",
      enhancer: "AfterInterceptor",
      next: ["POST /users#10"],
    },
    {
      id: "POST /users#10",
      kind: "interceptAfter",
      scope: "global",
      enhancer: "BothInterceptor",
      next: [],
    },
  ]);

  expect(trace.filters).toEqual([
    { kind: "filter", name: "CatchesErrorFilter", scope: "local", catch: ["Error"] },
    { kind: "filter", name: "CatchAllFilter", scope: "local", catch: [] },
    { kind: "filter", name: "GlobalFilter", scope: "global", catch: [] },
    { kind: "default", name: "ProblemDetailsMapping" },
  ]);
});

test("flow reads interceptor halves from the prototype when the boot recorded none", () => {
  const payload = buildFlowPayload(
    diagnostics({
      globalEnhancers: {
        guards: [],
        interceptors: [BeforeInterceptor, AfterInterceptor, EmptyInterceptor],
        filters: [],
      },
      routes: [{ module: "M", controller: "C", source: "compiled", route: route() }],
    }),
  );

  const stages = payload.routes[0]!.stages;
  expect(stages.map((stage) => stage.kind)).toEqual([
    "interceptBefore",
    "invoke",
    "handler",
    "interceptAfter",
  ]);
  expect(stages[0]?.enhancer).toBe("BeforeInterceptor");
  expect(stages[3]?.enhancer).toBe("AfterInterceptor");
});

test("flow publishes a callback route from what the callback states and skips a duplicate plan", () => {
  const payload = buildFlowPayload(
    diagnostics({
      routes: [
        {
          module: "M",
          controller: "C",
          source: "compiled",
          route: route({ method: "GET", path: "/same", propertyKey: "same" }),
        },
      ],
      callbackRoutes: [
        { module: "M", controller: "C", source: "compiled", method: "GET", path: "/same" },
        {
          module: "FilesModule",
          controller: "",
          source: "compiled",
          method: "POST",
          path: "/files",
        },
        {
          module: "FilesModule",
          controller: "FilesController",
          source: "compiled",
          method: "GET",
          path: "/files",
        },
      ],
    }),
  );

  expect(payload.routes.map((trace) => trace.id)).toEqual([
    "GET /files",
    "POST /files",
    "GET /same",
  ]);

  const post = payload.routes[1]!;
  expect(post.stages.map((stage) => ({ ...stage }))).toEqual([
    { id: "POST /files#0", kind: "invoke", source: "compiled", next: ["POST /files#1"] },
    { id: "POST /files#1", kind: "handler", next: [] },
  ]);
  expect(post.filters).toEqual([]);

  const get = payload.routes[0]!;
  expect(get.stages.map((stage) => ({ ...stage }))).toEqual([
    { id: "GET /files#0", kind: "invoke", source: "compiled", next: ["GET /files#1"] },
    {
      id: "GET /files#1",
      kind: "handler",
      controller: "FilesController",
      next: [],
    },
  ]);

  // The plan's entry is the one published for the duplicate, not the callback's.
  expect(payload.routes[2]?.stages.some((stage) => stage.handler === "same")).toBe(true);
});

test("flow tolerates record fields this release cannot read", () => {
  const payload = buildFlowPayload(
    diagnostics({
      globalEnhancers: { guards: "nope", interceptors: null, filters: [42] } as never,
      routes: [
        {
          module: "M",
          controller: "C",
          source: "compiled",
          route: route({
            schema: 42 as never,
            propertyKey: undefined as never,
            parameters: { not: "a list" } as never,
            enhancers: { guards: [null], interceptors: ["nope"], filters: undefined } as never,
          }),
        },
      ],
    }),
  );

  expect(payload.routes[0]?.stages.map((stage) => stage.kind)).toEqual(["invoke", "handler"]);
  expect(payload.routes[0]?.filters).toEqual([{ kind: "default", name: "ProblemDetailsMapping" }]);
});

test("flow filters a catch list down to the exception classes it can name", () => {
  const oddFilter = class OddFilter {};
  Reflect.defineMetadata(
    Symbol.for("aponia.enhancer-catch.metadata"),
    Object.freeze([TypeError, "not-a-class"]),
    oddFilter,
  );

  const payload = buildFlowPayload(
    diagnostics({
      routes: [
        {
          module: "M",
          controller: "C",
          source: "compiled",
          route: route({
            enhancers: { guards: [], interceptors: [], filters: [oddFilter] },
          }),
        },
      ],
    }),
  );

  expect(payload.routes[0]?.filters[0]).toEqual({
    kind: "filter",
    name: "OddFilter",
    scope: "local",
    catch: ["TypeError"],
  });
});
