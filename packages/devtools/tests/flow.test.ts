import { expect, test } from "bun:test";
import {
  Catch,
  Controller,
  Get,
  Module,
  Query,
  SubscribeMessage,
  UseFilters,
  UseGuards,
  UseInterceptors,
  Validation,
  WebSocketGateway,
  defineModule,
  provideClass,
  type LoggerService,
  type ModuleDefinition,
} from "@aponiajs/common";
import {
  AponiaFactory,
  PluginModule,
  defineControllerRoutes,
  controller,
} from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import {
  devtoolsPathPrefix,
  handleDevtoolsRequest,
  type AponiaRouteTracePayload,
  type AponiaRouteTrace,
} from "../src/index.ts";
// The handler record the mounted route answers through, from the module that owns
// it rather than the barrel: the surface is a route an application mounts, and
// this is the pair that route calls.
import { createHandlers } from "../src/server/devtools-server.ts";

/**
 * The flow endpoint: the stages each mounted route passes through, as a graph.
 *
 * Every case asks the pair the mounted route calls in process, so the assertions
 * are the wire shape rather than the builder's internals, and several fixtures
 * are bare `Elysia` instances a mount could not be placed on. The mount itself
 * is pinned over `application.handle` in `devtools-module.test.ts`, and the
 * dispatcher's `404` and `405` in `server.test.ts`.
 *
 * What they pin beyond the field names is where each answer comes from. The
 * stages Elysia contributes — a plugin's `derive`, its `resolve`, a plain
 * lifecycle hook — and the validation slots come from the mounted route entry,
 * read when the request arrives, because that entry belongs to the running
 * application. The route's own guards, interceptors, and filters come from the
 * compiled plan the boot recorded, because the platform lowered them into one
 * `beforeHandle` and one `afterHandle` where their order is no longer legible; a
 * compiled hook is therefore published as its parts and never as a hook stage.
 * And a route no record describes still answers with the hooks its own entry
 * carries rather than being dropped.
 */

const silentLogger: LoggerService = {
  log: () => {},
  fatal: () => {},
  error: () => {},
  warn: () => {},
};

/** One devtools path answered for one application. */
async function ask(application: Elysia, path: string): Promise<Response> {
  return await handleDevtoolsRequest(
    new Request(`http://localhost${devtoolsPathPrefix}${path}`),
    createHandlers(application, undefined, undefined, silentLogger),
  );
}

async function readFlow(application: Elysia): Promise<AponiaRouteTracePayload> {
  const response = await ask(application, "/flow");

  expect(response.status).toBe(200);

  return (await response.json()) as AponiaRouteTracePayload;
}

/** The one route a case is about, or a failure that names the route it wanted. */
function routeById(payload: AponiaRouteTracePayload, id: string): AponiaRouteTrace {
  const route = payload.routes.find((entry) => entry.id === id);

  if (route === undefined) {
    throw new Error(`the payload reports no route "${id}"`);
  }

  return route;
}

/**
 * The graph assertions a renderer relies on: every `next` names a stage of the
 * same route, no stage is unreachable from the first, and the ids are unique
 * within the route.
 */
function assertStageGraph(route: AponiaRouteTrace): void {
  const ids = new Set(route.stages.map((stage) => stage.id));

  expect(ids.size).toBe(route.stages.length);

  for (const stage of route.stages) {
    for (const next of stage.next) {
      expect(ids.has(next)).toBe(true);
    }
  }

  const first = route.stages[0]?.id;
  if (first === undefined) {
    return;
  }

  const reachable = new Set<string>();
  const queue: string[] = [first];

  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (reachable.has(current)) {
      continue;
    }

    reachable.add(current);
    const stage = route.stages.find((entry) => entry.id === current);
    queue.push(...(stage?.next ?? []));
  }

  expect([...reachable].sort()).toEqual([...ids].sort());
}

/**
 * The fixture whose enhancers are the whole point: a guard, an interceptor, and
 * a filter declared on a route, and one validation slot resolved through a
 * `@Validation()` model. A second route declares nothing, so the payload is
 * asked for both a route that runs every stage and one that runs almost none.
 */
class AuthGuard {
  canActivate(): boolean {
    return true;
  }
}

class AuditInterceptor {
  interceptBefore(): void {}

  interceptAfter(_context: unknown, response: unknown): unknown {
    return response;
  }
}

class MissingMessageError extends Error {}

@Catch(MissingMessageError)
class NotFoundFilter {
  catch(): unknown {
    return undefined;
  }
}

/**
 * The validator the fixture's validation model holds, stated as a Standard
 * Schema rather than as a TypeBox one.
 *
 * The fixture exists to pin that a `validate` stage names the model class its
 * route declared, and the validator kind does not reach that fact: the platform
 * resolves the class to the one validator its `@Validation()` decorator holds
 * and hands that validator to Elysia unchanged, which is one path for both
 * kinds. A Standard Schema is the kind whose entire shape is stated by
 * `@standard-schema/spec` and by the value below, so the fixture states a model
 * without depending on how the platform's native-validator contract names
 * TypeBox.
 */
const listMessagesValidator = {
  "~standard": {
    version: 1,
    vendor: "aponia.devtools",
    validate: (value: unknown) => ({ value }),
  },
} as const;

@Validation(listMessagesValidator)
class ListMessages {}

@Controller()
@UseGuards(AuthGuard)
class GuardedController {
  @Get("guarded", { query: ListMessages })
  @UseInterceptors(AuditInterceptor)
  @UseFilters(NotFoundFilter)
  read(@Query("limit") limit: string): string {
    return limit ?? "all";
  }

  @Get("plain")
  plain(): string {
    return "plain";
  }
}

@WebSocketGateway("/flow-socket")
class FlowGateway {
  @SubscribeMessage("ping")
  ping(): string {
    return "pong";
  }
}

@Module({
  controllers: [GuardedController],
  providers: [AuthGuard, AuditInterceptor, NotFoundFilter, FlowGateway],
})
class GuardedAppModule {}

/**
 * The fixture whose plugin contributes hooks.
 *
 * The plugin is named and contributes a hook to each of the three lifecycle
 * arrays this endpoint once read, because under Elysia 1 that is exactly what
 * made them appear as stages, with the checksum grouping one hook across the
 * routes it reaches. Elysia 2 holds every one of them as a bare function in the
 * route entry's lifecycle arrays and stamps no scope, checksum, or subType, so
 * the case below pins the contract the installed release leaves: the hooks are
 * contributed, the payload publishes none of them, and the stages a route
 * carries are the ones a source that states them owns.
 *
 * The first route also declares an interceptor, which is what puts an
 * identifiable stage beside the plugin's unidentifiable hooks on one route:
 * without both, a stage list that reported nothing at all would read the same as
 * one that reported only what it could name.
 */
const flowPlugin = new Elysia({ name: "devtools-flow-fixture" })
  .derive("global", () => ({ requestId: "fixture" }))
  .derive("global", () => ({ traceId: "fixture" }))
  .beforeHandle("global", () => {})
  .afterHandle("global", () => {});

class ContributedInterceptor {
  interceptBefore(): void {}

  interceptAfter(_context: unknown, response: unknown): unknown {
    return response;
  }
}

@Controller()
class ContributedController {
  @Get("first")
  @UseInterceptors(ContributedInterceptor)
  first(): string {
    return "first";
  }

  @Get("second")
  second(): string {
    return "second";
  }
}

@Module({
  imports: [PluginModule.register(flowPlugin, { key: "flow" })],
  controllers: [ContributedController],
  providers: [ContributedInterceptor],
})
class ContributedAppModule {}

/**
 * The fixture whose enhancers are the application's own. Global enhancers
 * resolve once through the root module and merge into every route the platform
 * mounts from a plan, so one route here carries both scopes and the payload has
 * to state which is which — and the interceptor's two halves are published in
 * opposite orders, because the after halves run over the whole list reversed. A
 * second route is mounted by a controller's callback, which is the other half
 * of the same platform rule: no plan and no compiled hook, so neither the
 * application's declaration nor the mapping reaches it.
 */
class GlobalGuard {
  canActivate(): boolean {
    return true;
  }
}

class LocalGuard {
  canActivate(): boolean {
    return true;
  }
}

class GlobalInterceptor {
  interceptBefore(): void {}

  interceptAfter(_context: unknown, response: unknown): unknown {
    return response;
  }
}

class LocalInterceptor {
  interceptBefore(): void {}

  interceptAfter(_context: unknown, response: unknown): unknown {
    return response;
  }
}

class BeforeOnlyInterceptor {
  interceptBefore(): void {}
}

class AfterOnlyInterceptor {
  interceptAfter(_context: unknown, response: unknown): unknown {
    return response;
  }
}

/**
 * The two halves declared as class fields rather than as prototype methods.
 *
 * This is the shape a class token cannot state: the platform calls the
 * interceptor's halves on the instance, and a field is an own property the
 * prototype never carries. The route below is what fails when the payload
 * decides a stage from the `prototype` alone — which is why the boot records the
 * halves it resolved, while the instance that implements them is in hand.
 */
class FieldInterceptor {
  interceptBefore = (): void => {};

  interceptAfter = (_context: unknown, response: unknown): unknown => response;
}

class GlobalFilter {
  catch(): unknown {
    return undefined;
  }
}

class LocalFilter {
  catch(): unknown {
    return undefined;
  }
}

class EdgeController {
  one(): string {
    return "one";
  }

  two(): string {
    return "two";
  }

  fields(): string {
    return "fields";
  }
}

class CallbackController {
  greet(): string {
    return "callback";
  }
}

const edgeModule: ModuleDefinition = defineModule({
  id: "FlowEdgeModule",
  controllers: [
    defineControllerRoutes(EdgeController, {
      path: "edge",
      routes: [
        {
          method: "GET",
          path: "/one",
          propertyKey: "one",
          guards: [LocalGuard],
          interceptors: [LocalInterceptor],
          filters: [LocalFilter],
        },
        {
          method: "GET",
          path: "/two",
          propertyKey: "two",
          interceptors: [BeforeOnlyInterceptor, AfterOnlyInterceptor],
        },
        {
          method: "GET",
          path: "/fields",
          propertyKey: "fields",
          interceptors: [FieldInterceptor],
        },
      ],
    }),
    controller(CallbackController, (application, controller) => {
      application.get("/callback", () => controller.greet());
      return application;
    }),
  ],
  providers: [
    provideClass(GlobalGuard, []),
    provideClass(LocalGuard, []),
    provideClass(GlobalInterceptor, []),
    provideClass(LocalInterceptor, []),
    provideClass(BeforeOnlyInterceptor, []),
    provideClass(AfterOnlyInterceptor, []),
    provideClass(FieldInterceptor, []),
    provideClass(GlobalFilter, []),
    provideClass(LocalFilter, []),
  ],
});

/** Boots the edge fixture with the application's own enhancer declaration. */
function bootEdgeApplication(): Promise<Elysia> {
  return AponiaFactory.createNative(edgeModule, {
    logger: false,
    guards: [GlobalGuard],
    interceptors: [GlobalInterceptor],
    filters: [GlobalFilter],
  });
}

test("the stages of a route are the ones it runs, in the order the code states", async () => {
  const application = await AponiaFactory.createNative(GuardedAppModule, { logger: false });
  const response = await ask(application, "/flow");
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toBe("no-store");

  const payload = await readFlow(application);

  // One assertion for the route's whole wire shape. The order is the point:
  // the slot Elysia validates, the guard and the before half the platform
  // lowered into one hook, the fields the compiled binding passes, the
  // binding that serves the route, the controller's method, and the after
  // half — which is published here as a stage of its own although the
  // platform compiled it into a single `afterHandle`.
  expect(routeById(payload, "GET /guarded")).toEqual({
    id: "GET /guarded",
    stages: [
      {
        id: "GET /guarded#0",
        kind: "validate",
        slot: "query",
        model: "ListMessages",
        next: ["GET /guarded#1"],
      },
      {
        id: "GET /guarded#1",
        kind: "guard",
        scope: "local",
        enhancer: "AuthGuard",
        next: ["GET /guarded#2"],
      },
      {
        id: "GET /guarded#2",
        kind: "interceptBefore",
        scope: "local",
        enhancer: "AuditInterceptor",
        next: ["GET /guarded#3"],
      },
      {
        id: "GET /guarded#3",
        kind: "bind",
        parameters: [{ index: 0, kind: "query", property: "limit" }],
        next: ["GET /guarded#4"],
      },
      {
        id: "GET /guarded#4",
        kind: "invoke",
        source: "compiled",
        next: ["GET /guarded#5"],
      },
      {
        id: "GET /guarded#5",
        kind: "handler",
        controller: "GuardedController",
        handler: "read",
        next: ["GET /guarded#6"],
      },
      {
        id: "GET /guarded#6",
        kind: "interceptAfter",
        scope: "local",
        enhancer: "AuditInterceptor",
        next: [],
      },
    ],
    filters: [
      { kind: "filter", name: "NotFoundFilter", scope: "local", catch: ["MissingMessageError"] },
      { kind: "default", name: "ProblemDetailsMapping" },
    ],
  });

  // A stage is published only when the route runs it. The guard is declared on
  // the controller, so it reaches both of the controller's routes, while the
  // interceptor and the filter are declared on the one handler and reach only
  // it. The second route declares no slot, so it carries no validation stage,
  // and it binds no field, so it runs no binding stage either.
  expect(routeById(payload, "GET /plain").stages.map((stage) => stage.kind)).toEqual([
    "guard",
    "invoke",
    "handler",
  ]);
});

test("a guard stage names the class it runs and the scope that declared it", async () => {
  const application = await AponiaFactory.createNative(GuardedAppModule, { logger: false });
  const route = routeById(await readFlow(application), "GET /guarded");
  const guard = route.stages.find((stage) => stage.kind === "guard");

  // The whole reason the payload carries an `enhancer` field: the compiled
  // hook cannot be read apart, so a stage that does not name its class tells
  // a reader nothing.
  expect(guard?.enhancer).toBe("AuthGuard");
  expect(guard?.scope).toBe("local");
});

test("filters are a list on the route, ordered as the error array is, and never a stage", async () => {
  const application = await AponiaFactory.createNative(GuardedAppModule, { logger: false });
  const payload = await readFlow(application);
  const route = routeById(payload, "GET /guarded");

  // The declared filter first, the Problem Details mapping last: that is the
  // order the route's own `error` array runs in, and the first entry that
  // answers is the one that decides. `catch` states what `@Catch()` named, so
  // an empty list is the filter that answers anything rather than a filter
  // that answers nothing.
  expect(route.filters).toEqual([
    { kind: "filter", name: "NotFoundFilter", scope: "local", catch: ["MissingMessageError"] },
    { kind: "default", name: "ProblemDetailsMapping" },
  ]);

  // Filters run when a guard or the handler threw, never on the happy path,
  // so a stage in the chain would claim something every request runs. The kind
  // is compared as the wire string it arrives as: the declared union already
  // forbids `"filter"`, and that is the guarantee this case holds the payload
  // to over HTTP rather than in the type.
  for (const entry of payload.routes) {
    expect(entry.stages.some((stage) => (stage.kind as string) === "filter")).toBe(false);
  }

  // The route that declares no filter still ends with the mapping, because
  // the platform mounts it on every route it compiles.
  expect(routeById(payload, "GET /plain").filters).toEqual([
    { kind: "default", name: "ProblemDetailsMapping" },
  ]);
});

test("every next names a stage the same route declares, and no stage is unreachable", async () => {
  const guarded = await AponiaFactory.createNative(GuardedAppModule, { logger: false });
  const contributed = await AponiaFactory.createNative(ContributedAppModule, { logger: false });
  const edge = await bootEdgeApplication();
  const applications = [guarded, contributed, edge];

  for (const application of applications) {
    const payload = await readFlow(application);
    expect(payload.routes.length).toBeGreaterThan(0);

    for (const route of payload.routes) {
      assertStageGraph(route);
    }
  }
});

test("a plugin's contributed hooks are published as no stage", async () => {
  const application = await AponiaFactory.createNative(ContributedAppModule, { logger: false });
  const payload = await readFlow(application);
  const first = routeById(payload, "GET /first");
  const second = routeById(payload, "GET /second");

  // The fixture's plugin contributes two derives, a plain before hook, and an
  // after hook. Elysia 2 holds every one of them as a bare function in the
  // route entry's lifecycle arrays and stamps neither a scope, a checksum, nor a
  // subType — measured on the mounted table — so nothing on the route says which
  // entries a plugin contributed and which the platform compiled. This endpoint
  // publishes a hook stage only for an entry it can identify, and an
  // unidentifiable entry is published as no stage, which is also what keeps the
  // platform's compiled `beforeHandle` and `afterHandle` out of the hook stages.
  //
  // What a route therefore carries is what a source that does state its stages
  // owns: the interceptor's two halves, from the compiled plan. Nothing names a
  // plugin, because nothing on the route carries one.
  expect(first.stages.map((stage) => [stage.kind, stage.scope, stage.enhancer])).toEqual([
    ["interceptBefore", "local", "ContributedInterceptor"],
    ["invoke", undefined, undefined],
    ["handler", undefined, undefined],
    ["interceptAfter", "local", "ContributedInterceptor"],
  ]);

  // The identity field is stated by no stage either: it is derived from the
  // checksum Elysia stamped on a hook, and no entry the installed release writes
  // carries one. The foreign-table case at the end of this file pins what the
  // reader does with a table that does.
  expect(first.stages.map((stage) => stage.hook)).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
  ]);

  // The second route declares no interceptor, so its own chain is the whole of
  // what this payload can state about it: the plugin's hooks reach it too, and
  // identify themselves no better there.
  expect(second.stages.map((stage) => [stage.kind, stage.hook])).toEqual([
    ["invoke", undefined],
    ["handler", undefined],
  ]);
});

test("a half an interceptor does not declare is not published as a stage", async () => {
  const application = await bootEdgeApplication();
  const route = routeById(await readFlow(application), "GET /edge/two");

  // The platform calls both halves with an optional call, so an interceptor
  // that declares one half runs one half. A stage is published only for a half
  // the class declares, which is the rule that governs the binding, the
  // invoker, and the validation slots too — so each class is a stage in the
  // half it declares and nothing in the other. The application's own
  // declarations are in the list beside them, and the after half is published
  // over the whole list reversed, which puts the half-only class ahead of the
  // global one.
  expect(route.stages.map((stage) => [stage.kind, stage.enhancer])).toEqual([
    ["guard", "GlobalGuard"],
    ["interceptBefore", "GlobalInterceptor"],
    ["interceptBefore", "BeforeOnlyInterceptor"],
    ["invoke", undefined],
    ["handler", undefined],
    ["interceptAfter", "AfterOnlyInterceptor"],
    ["interceptAfter", "GlobalInterceptor"],
  ]);
});

test("an interceptor half declared as a class field is published as a stage", async () => {
  const application = await bootEdgeApplication();
  const route = routeById(await readFlow(application), "GET /edge/fields");

  // The two stages are asserted by the class they name rather than by the
  // whole stage list, because the list also carries the application's own
  // declarations and whatever the route else declares. `FieldInterceptor`
  // implements both halves as fields, so both stages are what the route runs:
  // a payload that decided them from the class's `prototype` would report
  // neither, and the two `expect`s below are what fails there.
  const halves = route.stages.filter((stage) => stage.enhancer === "FieldInterceptor");

  expect(halves.map((stage) => stage.kind)).toEqual(["interceptBefore", "interceptAfter"]);
  expect(halves.map((stage) => stage.scope)).toEqual(["local", "local"]);
  // The order is the contract: the before half runs ahead of the handler and
  // the after half behind it, so the two are not adjacent — the invoke and the
  // handler sit between them.
  const before = halves[0]!;
  const after = halves[1]!;
  expect(route.stages.indexOf(after)).toBeGreaterThan(route.stages.indexOf(before));
});

test("a record whose interceptor halves this release cannot read falls back to the prototype", async () => {
  // The halves are this release's field, and the record arrives through a
  // registry-global symbol key: an older copy of the platform leaves the field
  // out entirely, a foreign one may hold something else under the name, a boot
  // that never resolved the class has no entry for it, and a value can borrow
  // `Map.prototype` without being a `Map` at all. Each of those falls back to
  // the class token's `prototype`, and none of them fails the request this
  // handler answers. Two of them would throw a `TypeError` out of the handler if
  // the read were not guarded: the borrowed map fails the lookup, and the value
  // that refuses its own prototype fails the brand check before any lookup runs.
  const fromPrototype: (string | undefined)[][] = [
    ["interceptBefore", "AuditInterceptor"],
    ["invoke", undefined],
    ["handler", undefined],
    ["interceptAfter", "AuditInterceptor"],
  ];
  const shapes: readonly {
    readonly shape: string;
    readonly halves: unknown;
    readonly expected: (string | undefined)[][];
  }[] = [
    { shape: "no field at all", halves: undefined, expected: fromPrototype },
    { shape: "a field that is not a map", halves: "not a map", expected: fromPrototype },
    { shape: "a map with no entry for the class", halves: new Map(), expected: fromPrototype },
    {
      // `instanceof Map` accepts it; its `get` does not.
      shape: "a map only by prototype",
      halves: Object.create(Map.prototype) as Map<unknown, unknown>,
      expected: fromPrototype,
    },
    {
      // `instanceof Map` is itself a walk of the value's prototype chain, so a
      // value that refuses that walk is answered before any lookup happens.
      shape: "a map-shaped value that refuses its prototype",
      halves: new Proxy(new Map<unknown, unknown>(), {
        getPrototypeOf: () => {
          throw new TypeError("this value has no prototype to walk");
        },
      }) as Map<unknown, unknown>,
      expected: fromPrototype,
    },
    {
      shape: "an entry that is not a halves pair",
      halves: new Map([[AuditInterceptor, null]]),
      expected: fromPrototype,
    },
    {
      shape: "a pair whose halves are not booleans",
      halves: new Map([[AuditInterceptor, { before: "true", after: "true" }]]),
      expected: fromPrototype,
    },
    {
      // The record is what the boot resolved, so it answers ahead of the
      // prototype rather than beside it: a class recorded as implementing
      // neither half publishes neither stage, although its prototype declares
      // both.
      shape: "a pair that states neither half",
      halves: new Map([[AuditInterceptor, { before: false, after: false }]]),
      expected: [
        ["invoke", undefined],
        ["handler", undefined],
      ],
    },
  ];

  for (const { shape, halves, expected } of shapes) {
    const application = new Elysia();
    application.get("/", () => "older");
    Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
      value: {
        framework: "0.0.0-older",
        interceptorHalves: halves,
        routes: [
          {
            module: "OlderModule",
            controller: "OlderController",
            route: {
              method: "GET",
              path: "/",
              propertyKey: "read",
              parameters: [],
              schema: undefined,
              enhancers: { guards: [], interceptors: [AuditInterceptor], filters: [] },
            },
          },
        ],
      },
      enumerable: false,
    });

    const stages = routeById(await readFlow(application), "GET /").stages;

    // The shape is read back with the assertion, so a failure names which
    // record it was rather than only which stage list differed.
    expect({ shape, stages: stages.map((stage) => [stage.kind, stage.enhancer]) }).toEqual({
      shape,
      stages: expected,
    });
  }
});

test("a hook that declares no scope is published as no stage", async () => {
  // A hook an instance-level lifecycle API declares reaches the route entry as
  // a bare function, with no scope, no checksum, and no subType — Elysia 2
  // stopped stamping the scope, where Elysia 1 stamped the default `"local"` on
  // one the caller declared none for. There is therefore nothing on the route
  // that tells such a hook from the platform's compiled one, and this endpoint
  // publishes a hook stage only for an entry it can identify.
  const bare = new Elysia();
  bare.beforeHandle(() => {});
  bare.get("/", () => "bare");

  // An application no boot produced: the mounted table is the whole source, and
  // the hook it holds names nothing. The route is still reported, because the
  // table is what the application answers.
  expect(await readFlow(bare)).toEqual({
    routes: [{ id: "GET /", stages: [], filters: [] }],
  });

  // The same declaration beside a booted application's compiled routes, so both
  // halves of the rule are in one table: what a source can name is published,
  // and what it cannot is not.
  const application = await AponiaFactory.createNative(GuardedAppModule, { logger: false });
  application.beforeHandle(() => {});
  application.get("/undeclared", () => "undeclared");
  const payload = await readFlow(application);

  // The platform lowered the guarded route's guard and interceptor into one
  // `beforeHandle` and one `afterHandle`, and the payload publishes the parts
  // rather than the hooks: that is what the rule above buys.
  expect(routeById(payload, "GET /guarded").stages.map((stage) => stage.kind)).toEqual([
    "validate",
    "guard",
    "interceptBefore",
    "bind",
    "invoke",
    "handler",
    "interceptAfter",
  ]);

  // The route the application mounted after the boot carries no plan and
  // therefore no stage the record owns, so the instance-level hook is the only
  // entry it has and the payload states none of it.
  expect(routeById(payload, "GET /undeclared")).toEqual({
    id: "GET /undeclared",
    stages: [],
    filters: [],
  });
});

test("a hook Elysia scopes globally is published as no stage", async () => {
  // The other declaration shape an instance-level API accepts: a scope named
  // rather than defaulted. Elysia 2 stamps neither, so the payload cannot tell
  // this hook from an unscoped one and publishes it the same way — as no stage.
  const application = new Elysia();
  application.beforeHandle("global", () => {});
  application.get("/", () => "native");

  expect(await readFlow(application)).toEqual({
    routes: [{ id: "GET /", stages: [], filters: [] }],
  });
});

test("the application's own enhancers run before the route's, and the after halves are reversed", async () => {
  const application = await bootEdgeApplication();
  const route = routeById(await readFlow(application), "GET /edge/one");

  // Each scope in declaration order, the application's own first: the guards,
  // then the before halves of the same list, then the rest of the chain. The
  // after halves run over the whole interceptor list reversed, so the local
  // interceptor's half is published before the global one's.
  expect(route.stages.map((stage) => [stage.kind, stage.scope, stage.enhancer])).toEqual([
    ["guard", "global", "GlobalGuard"],
    ["guard", "local", "LocalGuard"],
    ["interceptBefore", "global", "GlobalInterceptor"],
    ["interceptBefore", "local", "LocalInterceptor"],
    ["invoke", undefined, undefined],
    ["handler", undefined, undefined],
    ["interceptAfter", "local", "LocalInterceptor"],
    ["interceptAfter", "global", "GlobalInterceptor"],
  ]);

  // A declared filter runs before the application's own and both run before
  // the mapping every route carries last, which is the reverse of the guard
  // order for the same reason: the most specific declaration decides.
  expect(route.filters).toEqual([
    { kind: "filter", name: "LocalFilter", scope: "local", catch: [] },
    { kind: "filter", name: "GlobalFilter", scope: "global", catch: [] },
    { kind: "default", name: "ProblemDetailsMapping" },
  ]);
});

test("a parameter list this release cannot fully read binds what it can read", async () => {
  // The list is the record's, so each entry is published only when it states the
  // fields this release writes: an index that is a number and a kind the
  // decorators declare. An entry it cannot read is dropped rather than
  // republished as an argument the route never bound, a property that is not a
  // string reads as no property, and the entries it can read are still reported —
  // which keeps a foreign entry a lost parameter rather than a lost route.
  const application = new Elysia();
  application.get("/", () => "parameters");
  Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
    value: {
      routes: [
        {
          module: "ForeignModule",
          controller: "ForeignController",
          route: {
            method: "GET",
            path: "/",
            propertyKey: "read",
            parameters: [
              { index: 0, kind: "query", property: "limit" },
              { index: "one", kind: "query" },
              { index: 1, kind: "not a kind" },
              { index: 2, kind: "body", property: 7 },
              "not a parameter",
            ],
            schema: undefined,
            enhancers: { guards: [], interceptors: [], filters: [] },
          },
        },
      ],
    },
    enumerable: false,
  });

  expect(
    routeById(await readFlow(application), "GET /").stages.map((stage) => [
      stage.kind,
      stage.parameters,
    ]),
  ).toEqual([
    [
      "bind",
      [
        { index: 0, kind: "query", property: "limit" },
        // The entry states a property this release cannot read, so it is
        // published with none rather than with `7`.
        { index: 2, kind: "body", property: undefined },
      ],
    ],
    ["invoke", undefined],
    ["handler", undefined],
  ]);
});

test("a filter whose catch metadata is not a list is published with no types", async () => {
  // `@Catch()` is what stores a filter's exception list, and the metadata read
  // answers whatever is stored under its key: a class whose metadata was written
  // by hand — no decorator involved — carries a list this release cannot walk,
  // and mapping over it would fail the request this handler answers. The stage
  // states the absence, which is the shape a filter that declared no `@Catch()`
  // publishes rather than a type it never declared.
  class HandwrittenFilter {}
  Reflect.defineMetadata(
    Symbol.for("aponia.enhancer-catch.metadata"),
    "not a list",
    HandwrittenFilter,
  );

  const application = new Elysia();
  application.get("/", () => "hand-written");
  Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
    value: {
      routes: [
        {
          module: "HandwrittenModule",
          controller: "HandwrittenController",
          route: {
            method: "GET",
            path: "/",
            propertyKey: "read",
            parameters: [],
            schema: undefined,
            enhancers: { guards: [], interceptors: [], filters: [HandwrittenFilter] },
          },
        },
      ],
    },
    enumerable: false,
  });

  expect(routeById(await readFlow(application), "GET /").filters).toEqual([
    { kind: "filter", name: "HandwrittenFilter", scope: "local", catch: [] },
    { kind: "default", name: "ProblemDetailsMapping" },
  ]);
});

test("a route a controller's callback mounted is reported with the controller that mounted it", async () => {
  const application = await bootEdgeApplication();
  const route = routeById(await readFlow(application), "GET /callback");

  // The record states the module and the controller whose callback mounted
  // the route and no plan, so the payload reports the controller, the binding
  // the boot decided on, and neither a handler name nor a filter: the
  // property key that built the route exists only while the callback ran, and
  // the platform compiles no `error` array for a route it mounted from a
  // callback. The application's own guard is absent for the same reason — the
  // route carries no compiled hook for it to have merged into.
  expect(route).toEqual({
    id: "GET /callback",
    stages: [
      {
        id: "GET /callback#0",
        kind: "invoke",
        source: "compiled",
        next: ["GET /callback#1"],
      },
      {
        id: "GET /callback#1",
        kind: "handler",
        controller: "CallbackController",
        next: [],
      },
    ],
    filters: [],
  });
});

test("flow reads the mounted table when it is asked, not when the surface mounted", async () => {
  const application = await bootEdgeApplication();
  expect((await readFlow(application)).routes.some((route) => route.id === "GET /late")).toBe(
    false,
  );

  // A route mounted on the native application after the boot — the escape
  // hatch an application reaches for before it listens — is a route the
  // application answers, and a payload frozen when the handlers were built
  // would not report it at all. Nothing describes its stages: no record holds
  // a plan for it, so it publishes no stage the record owns and no filter.
  application.get("/late", () => "late");

  expect(routeById(await readFlow(application), "GET /late")).toEqual({
    id: "GET /late",
    stages: [],
    filters: [],
  });
  expect(await (await application.handle(new Request("http://localhost/late"))).text()).toBe(
    "late",
  );
});

test("flow reports every route the table holds, in one deterministic order", async () => {
  const application = await AponiaFactory.createNative(GuardedAppModule, { logger: false });
  const payload = await readFlow(application);

  // The route set is the mounted table's, never a plan's: the table is what
  // the application answers, so a WebSocket route no record describes is
  // reported beside the controller's routes rather than dropped. The order is
  // the one the payload states, asserted as a literal list rather than
  // recomputed with the rule it is checking — the WebSocket route sorts first
  // on its path, although the application mounts it after the two controller
  // routes.
  expect(payload.routes.map((route) => route.id)).toEqual([
    "WS /flow-socket",
    "GET /guarded",
    "GET /plain",
  ]);
  expect(routeById(payload, "WS /flow-socket")).toEqual({
    id: "WS /flow-socket",
    stages: [],
    filters: [],
  });
  expect((await readFlow(application)).routes.map((route) => route.id)).toEqual([
    "WS /flow-socket",
    "GET /guarded",
    "GET /plain",
  ]);

  // The second key is exercised rather than assumed: the two `/alpha` routes are
  // mounted `POST` before `GET` while the payload states `GET` first, and
  // `/zeta`, mounted first, sorts last. The mounted table cannot hold two routes
  // under one method and path, so path and method are already a total order and
  // the payload states nothing further to compare — which is why the keys
  // `/routes` breaks its own ties with are not part of this rule.
  const ordered = new Elysia();
  ordered.get("/zeta", () => "zeta");
  ordered.post("/alpha", () => "alpha");
  ordered.get("/alpha", () => "alpha");
  expect((await readFlow(ordered)).routes.map((route) => route.id)).toEqual([
    "GET /alpha",
    "POST /alpha",
    "GET /zeta",
  ]);
});

test("a route no boot recorded reports no binding rather than a binding it never chose", async () => {
  // The record is read through a registry-global symbol key, so a boot run by a
  // copy of `@aponiajs/platform-elysia` older than the binding state is
  // reachable from here — and that copy's plans carry no `source`. `null` is
  // the answer: a guess published where a decided state belongs would make one
  // boot's routes look interchangeable with another's.
  const application = new Elysia();
  application.get("/", () => "older");
  Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
    value: {
      framework: "0.0.0-older",
      graph: "decorated",
      routes: [
        {
          module: "OlderModule",
          controller: "OlderController",
          route: {
            method: "GET",
            path: "/",
            propertyKey: "read",
            parameters: [],
            capabilities: [],
            schema: undefined,
            declaredParameterCount: 0,
            declaredReturnKind: "synchronous",
            enhancers: { guards: [], interceptors: [], filters: [] },
          },
        },
      ],
    },
    enumerable: false,
  });

  expect(routeById(await readFlow(application), "GET /")).toEqual({
    id: "GET /",
    stages: [
      { id: "GET /#0", kind: "invoke", source: null, next: ["GET /#1"] },
      {
        id: "GET /#1",
        kind: "handler",
        controller: "OlderController",
        handler: "read",
        next: [],
      },
    ],
    filters: [{ kind: "default", name: "ProblemDetailsMapping" }],
  });
});

test("a record whose plans are not the shape this release writes still answers", async () => {
  // The other side of the version skew: a foreign copy of the platform may hold
  // the same key with plans whose fields are not the ones this release writes.
  // This handler answers a request, where a throw is that request's failure,
  // so a plan whose enhancer lists, parameter lists,
  // handler name, and binding state cannot be read is stated as the empty facts
  // they are: no guards, no binding, no name, no binding state in place of the
  // value it does state, and the mapping every compiled route carries.
  const application = new Elysia();
  application.get("/", () => "foreign");
  Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
    value: {
      framework: "9.9.9",
      routes: [
        {
          module: "ForeignModule",
          controller: "ForeignController",
          route: {
            method: "GET",
            path: "/",
            propertyKey: 7,
            parameters: "not a list",
            schema: "not a schema",
            enhancers: "not a list",
          },
          // A binding state this release does not write is republished as the
          // absence rather than as a state: `null` is the one value that says
          // "no binding this release can name" without inventing one, and
          // publishing it verbatim would place a foreign state on this route.
          source: "bundled",
        },
      ],
      globalEnhancers: { guards: "not a list", interceptors: null, filters: undefined },
    },
    enumerable: false,
  });

  expect(routeById(await readFlow(application), "GET /")).toEqual({
    id: "GET /",
    stages: [
      { id: "GET /#0", kind: "invoke", source: null, next: ["GET /#1"] },
      { id: "GET /#1", kind: "handler", controller: "ForeignController", next: [] },
    ],
    filters: [{ kind: "default", name: "ProblemDetailsMapping" }],
  });
});

test("an application no boot produced still answers, and a route no record describes publishes no filter", async () => {
  const bare = new Elysia();
  // The mounted table is the application's own fact, so the endpoint answers
  // for an application this package knows nothing about — with no routes for
  // one that answers none.
  expect(await readFlow(bare)).toEqual({ routes: [] });

  const native = new Elysia();
  native.get("/", () => "native");
  // One route, no stage any source states, and no filter: only the platform's
  // own compilation records the enhancers and the mapping a route carries,
  // and this route was mounted by nothing that compiled either.
  expect(await readFlow(native)).toEqual({
    routes: [{ id: "GET /", stages: [], filters: [] }],
  });
});

test("a route table this release cannot walk still answers with what it can read", async () => {
  // The table is Elysia's, not this release's, so both halves of it are what the
  // installed release holds rather than what this one expects — and this handler
  // answers a request, where a throw is that request's failure. An entry this
  // release cannot join costs a route, and a hook entry carrying no identity
  // costs a stage, but neither costs the report.
  const unwalkable = { routes: {} } as unknown as Elysia;
  expect(await readFlow(unwalkable)).toEqual({ routes: [] });

  const application = {
    routes: [
      // A route with no method or path cannot be joined to a record entry or
      // published under an id, so it is dropped rather than rendered as one.
      { method: 7, path: null },
      // A route whose entry carries no walkable hooks object runs no stage this
      // endpoint can read: the plan still states what serves it.
      { method: "GET", path: "/nohooks" },
      {
        method: "GET",
        path: "/foreign",
        hooks: {
          transform: "not a list",
          beforeHandle: [
            // Neither a scope this release knows nor a checksum: nothing groups
            // this hook and nothing can be stated about where it came from.
            { fn: () => {} },
            // A scope this release does not know, with a checksum: the identity
            // is still groupable, so only the scope is left out.
            { fn: () => {}, scope: "volatile", checksum: 41 },
            // A primitive entry is not a hook at all.
            "not a hook",
          ],
          // A slot Elysia holds a validator for, which is what publishes the
          // validation stage; the plan is what states the model behind it.
          body: {},
        },
      },
      // The same slot with a schema this release can walk to it, so the read
      // that resolves a model meets a value that is not one.
      { method: "GET", path: "/slots", hooks: { query: {} } },
    ],
    [Symbol.for("aponia.application.diagnostics")]: {
      framework: "9.9.9",
      routes: [
        {
          module: "ForeignModule",
          controller: "ForeignController",
          route: {
            method: "GET",
            path: "/nohooks",
            propertyKey: "read",
            parameters: [],
            schema: "not a schema",
            enhancers: { guards: [], interceptors: [], filters: [] },
          },
        },
        {
          module: "ForeignModule",
          controller: "ForeignController",
          route: {
            method: "GET",
            path: "/foreign",
            propertyKey: "foreign",
            parameters: [],
            schema: "not a schema",
            enhancers: { guards: [], interceptors: [], filters: [] },
          },
        },
        {
          module: "ForeignModule",
          controller: "ForeignController",
          route: {
            method: "GET",
            path: "/slots",
            propertyKey: "slots",
            parameters: [],
            schema: { query: "not a validator" },
            enhancers: { guards: [], interceptors: [], filters: [] },
          },
        },
      ],
      globalEnhancers: { guards: [], interceptors: [], filters: [] },
    },
  } as unknown as Elysia;

  // A route with no validators to name: the hooks read as no stage, and the
  // plan still states the binding and the method that serves it.
  expect(routeById(await readFlow(application), "GET /nohooks")).toEqual({
    id: "GET /nohooks",
    stages: [
      { id: "GET /nohooks#0", kind: "invoke", source: null, next: ["GET /nohooks#1"] },
      {
        id: "GET /nohooks#1",
        kind: "handler",
        controller: "ForeignController",
        handler: "read",
        next: [],
      },
    ],
    filters: [{ kind: "default", name: "ProblemDetailsMapping" }],
  });

  const foreign = routeById(await readFlow(application), "GET /foreign");

  // The scope is what is left out, never the stage: an unknown scope is not
  // one of the two this payload states, so the stage states none.
  expect(foreign.stages.map((stage) => [stage.kind, stage.scope, stage.hook])).toEqual([
    ["validate", undefined, undefined],
    ["hook", undefined, "beforeHandle:hook:41"],
    ["invoke", undefined, undefined],
    ["handler", undefined, undefined],
  ]);
  // A slot whose model cannot be resolved names no model rather than the value
  // it read, which is what an unresolvable validator is.
  expect(foreign.stages[0]?.model).toBeUndefined();

  expect(routeById(await readFlow(application), "GET /slots")).toEqual({
    id: "GET /slots",
    stages: [
      { id: "GET /slots#0", kind: "validate", slot: "query", next: ["GET /slots#1"] },
      { id: "GET /slots#1", kind: "invoke", source: null, next: ["GET /slots#2"] },
      {
        id: "GET /slots#2",
        kind: "handler",
        controller: "ForeignController",
        handler: "slots",
        next: [],
      },
    ],
    filters: [{ kind: "default", name: "ProblemDetailsMapping" }],
  });
});
