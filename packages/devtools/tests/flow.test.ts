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
  ElysiaPluginModule,
  defineElysiaControllerRoutes,
  elysiaController,
} from "@aponiajs/platform-elysia";
import { Elysia, t } from "elysia";
import {
  startDevtoolsServer,
  type AponiaFlowPayload,
  type AponiaFlowRoute,
  type DevtoolsServer,
} from "../src/index.ts";

/**
 * The flow endpoint: the stages each mounted route passes through, as a graph.
 *
 * Every case fetches a socket that bound port `0` and reads the address it took
 * back out of it, so the assertions are the wire shape rather than the
 * builder's internals. What they pin beyond the field names is where each
 * answer comes from. The stages Elysia contributes — a plugin's `derive`, its
 * `resolve`, a plain lifecycle hook — and the validation slots come from the
 * mounted route entry, read when the request arrives, because that entry
 * belongs to the running application. The route's own guards, interceptors, and
 * filters come from the compiled plan the boot recorded, because the platform
 * lowered them into one `beforeHandle` and one `afterHandle` where their order
 * is no longer legible; a compiled hook is therefore published as its parts and
 * never as a hook stage. And a route no record describes still answers with the
 * hooks its own entry carries rather than being dropped.
 */

const silentLogger: LoggerService = {
  log: () => {},
  fatal: () => {},
  error: () => {},
  warn: () => {},
};

/** Binds the loopback socket on port `0` and reads the address it took. */
function serveLoopback(application: Elysia): DevtoolsServer {
  const server = startDevtoolsServer({ application, port: 0, logger: silentLogger });

  if (server === undefined) {
    throw new Error("the devtools server refused to bind the loopback socket");
  }

  return server;
}

async function readFlow(server: DevtoolsServer): Promise<AponiaFlowPayload> {
  const response = await fetch(`${server.url}/__devtools/flow`);

  expect(response.status).toBe(200);

  return (await response.json()) as AponiaFlowPayload;
}

/** The one route a case is about, or a failure that names the route it wanted. */
function routeById(payload: AponiaFlowPayload, id: string): AponiaFlowRoute {
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
function assertStageGraph(route: AponiaFlowRoute): void {
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

@Validation(
  t.Object({
    limit: t.Optional(t.String()),
  }),
)
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
 * The fixture whose stages Elysia contributes. The plugin is named, because
 * only a named plugin's hooks carry a checksum, and the checksum is the one
 * thing that groups the same hook across the routes it reaches — which is what
 * the payload publishes as the hook's identity. It contributes a hook to the
 * after phase as well, so the case states where Elysia's own after hook runs
 * relative to the platform's compiled one.
 *
 * The first route also declares an interceptor, which is what puts a contributed
 * after hook and a compiled after half on one route: without both, the line that
 * publishes Elysia's after hooks ahead of the after halves could move with every
 * case still green.
 */
const flowPlugin = new Elysia({ name: "devtools-flow-fixture" })
  .derive({ as: "global" }, () => ({ requestId: "fixture" }))
  .resolve({ as: "global" }, () => ({ traceId: "fixture" }))
  .onBeforeHandle({ as: "global" }, () => {})
  .onAfterHandle({ as: "global" }, () => {});

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
  imports: [ElysiaPluginModule.register(flowPlugin, { key: "flow" })],
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
}

class CallbackController {
  greet(): string {
    return "callback";
  }
}

const edgeModule: ModuleDefinition = defineModule({
  id: "FlowEdgeModule",
  controllers: [
    defineElysiaControllerRoutes(EdgeController, {
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
      ],
    }),
    elysiaController(CallbackController, (application, controller) => {
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
  const server = serveLoopback(application);

  try {
    const response = await fetch(`${server.url}/__devtools/flow`);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const payload = await readFlow(server);

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
  } finally {
    server.stop();
  }
});

test("a guard stage names the class it runs and the scope that declared it", async () => {
  const application = await AponiaFactory.createNative(GuardedAppModule, { logger: false });
  const server = serveLoopback(application);

  try {
    const route = routeById(await readFlow(server), "GET /guarded");
    const guard = route.stages.find((stage) => stage.kind === "guard");

    // The whole reason the payload carries an `enhancer` field: the compiled
    // hook cannot be read apart, so a stage that does not name its class tells
    // a reader nothing.
    expect(guard?.enhancer).toBe("AuthGuard");
    expect(guard?.scope).toBe("local");
  } finally {
    server.stop();
  }
});

test("filters are a list on the route, ordered as the error array is, and never a stage", async () => {
  const application = await AponiaFactory.createNative(GuardedAppModule, { logger: false });
  const server = serveLoopback(application);

  try {
    const payload = await readFlow(server);
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
  } finally {
    server.stop();
  }
});

test("every next names a stage the same route declares, and no stage is unreachable", async () => {
  const guarded = await AponiaFactory.createNative(GuardedAppModule, { logger: false });
  const contributed = await AponiaFactory.createNative(ContributedAppModule, { logger: false });
  const edge = await bootEdgeApplication();
  const servers = [serveLoopback(guarded), serveLoopback(contributed), serveLoopback(edge)];

  try {
    for (const server of servers) {
      const payload = await readFlow(server);
      expect(payload.routes.length).toBeGreaterThan(0);

      for (const route of payload.routes) {
        assertStageGraph(route);
      }
    }
  } finally {
    for (const server of servers) {
      server.stop();
    }
  }
});

test("a contributed hook reports an identity and never a plugin name", async () => {
  const application = await AponiaFactory.createNative(ContributedAppModule, { logger: false });
  const server = serveLoopback(application);

  try {
    const payload = await readFlow(server);
    const first = routeById(payload, "GET /first");
    const second = routeById(payload, "GET /second");

    // The hooks one named plugin contributed, in the order Elysia runs them:
    // its `derive`, its `resolve`, and a plain before hook ahead of the
    // platform's compiled one, then the handler, then its after hook — which
    // Elysia runs before the `afterHandle` the platform compiled, so it is
    // published before the after halves rather than last. Each is named by its
    // kind rather than by its plugin, because the plugin that contributed a
    // hook is not carried on the route. The interceptor beside them is the other
    // side of that rule: the platform resolved that class itself, so its two
    // halves carry the class name and the contributed hooks carry none.
    expect(first.stages.map((stage) => stage.kind)).toEqual([
      "derive",
      "resolve",
      "hook",
      "interceptBefore",
      "invoke",
      "handler",
      "hook",
      "interceptAfter",
    ]);
    expect(first.stages.map((stage) => stage.scope)).toEqual([
      "global",
      "global",
      "global",
      "local",
      undefined,
      undefined,
      "global",
      "local",
    ]);

    // No plugin name is reported, because nothing on the route carries one: the
    // one stage list here that names a class is the interceptor's, which the
    // plan states rather than Elysia.
    for (const stage of first.stages) {
      if (stage.kind === "hook" || stage.kind === "derive" || stage.kind === "resolve") {
        expect(stage.enhancer).toBeUndefined();
      }
    }
    expect(first.stages[3]?.enhancer).toBe("ContributedInterceptor");

    // The identity is the phase, the kind, the scope, and the checksum: the
    // checksum is what groups a hook across the routes it reaches, and the
    // phase is what separates two plain hooks one plugin contributed to the two
    // halves of one request, which carry the same checksum.
    const identities = first.stages.map((stage) => stage.hook);
    expect(identities).toEqual([
      expect.stringMatching(/^transform:derive:global:-?\d+$/),
      expect.stringMatching(/^beforeHandle:resolve:global:-?\d+$/),
      expect.stringMatching(/^beforeHandle:hook:global:-?\d+$/),
      undefined,
      undefined,
      undefined,
      expect.stringMatching(/^afterHandle:hook:global:-?\d+$/),
      undefined,
    ]);

    // The same hook reaching two routes reports the same identity, which is
    // what makes the field an identity rather than a per-route label. The second
    // route declares no interceptor, so it runs the stages its own entry and the
    // plan state alone and carries the same three hook identities in the same
    // order.
    expect(second.stages.map((stage) => stage.hook)).toEqual([
      identities[0],
      identities[1],
      identities[2],
      undefined,
      undefined,
      identities[6],
    ]);
  } finally {
    server.stop();
  }
});

test("a half an interceptor does not declare is not published as a stage", async () => {
  const application = await bootEdgeApplication();
  const server = serveLoopback(application);

  try {
    const route = routeById(await readFlow(server), "GET /edge/two");

    // The platform calls both halves with an optional call, so an interceptor
    // that declares one half runs one half. A stage is published only when the
    // route runs it, which is the rule that governs the binding, the invoker,
    // and the validation slots too — so each class is a stage in the half it
    // declares and nothing in the other. The application's own declarations are
    // in the list beside them, and the after half is published over the whole
    // list reversed, which puts the half-only class ahead of the global one.
    expect(route.stages.map((stage) => [stage.kind, stage.enhancer])).toEqual([
      ["guard", "GlobalGuard"],
      ["interceptBefore", "GlobalInterceptor"],
      ["interceptBefore", "BeforeOnlyInterceptor"],
      ["invoke", undefined],
      ["handler", undefined],
      ["interceptAfter", "AfterOnlyInterceptor"],
      ["interceptAfter", "GlobalInterceptor"],
    ]);
  } finally {
    server.stop();
  }
});

test("a hook that declares no scope is published with the scope Elysia stamped", async () => {
  // Every other fixture declares `as`, so the scope the payload reads would keep
  // looking right even if Elysia stopped stamping one: this endpoint tells a
  // contributed hook from the platform's compiled one by that stamp, and a hook
  // it cannot identify is left out rather than published. A hook that declares
  // no scope at all is where that rule would go wrong silently, so both shapes
  // are pinned here.
  const bare = new Elysia();
  bare.onBeforeHandle(() => {});
  bare.get("/", () => "bare");
  const bareServer = serveLoopback(bare);

  try {
    // An unnamed instance stamps the default scope and no checksum, so the scope
    // is the only thing that makes this entry a stage: without it the hook would
    // be indistinguishable from a compiled one and would vanish from the payload.
    expect(await readFlow(bareServer)).toEqual({
      routes: [
        {
          id: "GET /",
          stages: [{ id: "GET /#0", kind: "hook", scope: "local", next: [] }],
          filters: [],
        },
      ],
    });
  } finally {
    bareServer.stop();
  }

  // The same declaration on a booted application, whose root instance is named:
  // the scope is still the default Elysia stamps, and the name gives the hook a
  // checksum, so the identity is published beside it.
  const application = await AponiaFactory.createNative(GuardedAppModule, { logger: false });
  application.onBeforeHandle(() => {});
  application.get("/undeclared", () => "undeclared");
  const server = serveLoopback(application);

  try {
    const route = routeById(await readFlow(server), "GET /undeclared");

    expect(route.stages.map((stage) => [stage.kind, stage.scope])).toEqual([["hook", "local"]]);
    expect(route.stages[0]?.hook).toMatch(/^beforeHandle:hook:local:-?\d+$/);
  } finally {
    server.stop();
  }
});

test("a hook Elysia identifies by scope alone is published without an identity", async () => {
  // An application this package knows nothing about: a plain instance that
  // registered a global hook and then a route. Elysia stamps the hook with a
  // scope and no checksum — a checksum comes from a named plugin, and this
  // instance has no name. The identity is derived from the checksum, so there
  // is none to report: nothing would group that hook with the same one reaching
  // another route, and a per-route label would be the opposite of an identity.
  const application = new Elysia();
  application.onBeforeHandle({ as: "global" }, () => {});
  application.get("/", () => "native");
  const server = serveLoopback(application);

  try {
    expect(await readFlow(server)).toEqual({
      routes: [
        {
          id: "GET /",
          stages: [{ id: "GET /#0", kind: "hook", scope: "global", next: [] }],
          filters: [],
        },
      ],
    });
  } finally {
    server.stop();
  }
});

test("the application's own enhancers run before the route's, and the after halves are reversed", async () => {
  const application = await bootEdgeApplication();
  const server = serveLoopback(application);

  try {
    const route = routeById(await readFlow(server), "GET /edge/one");

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
  } finally {
    server.stop();
  }
});

test("a route a controller's callback mounted is reported with the controller that mounted it", async () => {
  const application = await bootEdgeApplication();
  const server = serveLoopback(application);

  try {
    const route = routeById(await readFlow(server), "GET /callback");

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
  } finally {
    server.stop();
  }
});

test("flow reads the mounted table when it is asked, not when the server started", async () => {
  const application = await bootEdgeApplication();
  const server = serveLoopback(application);

  try {
    expect((await readFlow(server)).routes.some((route) => route.id === "GET /late")).toBe(false);

    // A route mounted on the native application after the boot — the escape
    // hatch an application reaches for before it listens — is a route the
    // application answers, and a payload frozen at `onStart` would not report it
    // at all. Nothing describes its stages: no record holds a plan for it, so
    // it publishes no stage the record owns and no filter.
    application.get("/late", () => "late");

    expect(routeById(await readFlow(server), "GET /late")).toEqual({
      id: "GET /late",
      stages: [],
      filters: [],
    });
    expect(await (await application.handle(new Request("http://localhost/late"))).text()).toBe(
      "late",
    );
  } finally {
    server.stop();
  }
});

test("flow reports every route the table holds, in one deterministic order", async () => {
  const application = await AponiaFactory.createNative(GuardedAppModule, { logger: false });
  const server = serveLoopback(application);

  try {
    const payload = await readFlow(server);

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
    expect((await readFlow(server)).routes.map((route) => route.id)).toEqual([
      "WS /flow-socket",
      "GET /guarded",
      "GET /plain",
    ]);
  } finally {
    server.stop();
  }

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
  const orderedServer = serveLoopback(ordered);

  try {
    expect((await readFlow(orderedServer)).routes.map((route) => route.id)).toEqual([
      "GET /alpha",
      "POST /alpha",
      "GET /zeta",
    ]);
  } finally {
    orderedServer.stop();
  }
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

  const server = serveLoopback(application);

  try {
    expect(routeById(await readFlow(server), "GET /")).toEqual({
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
  } finally {
    server.stop();
  }
});

test("a record whose plans are not the shape this release writes still answers", async () => {
  // The other side of the version skew: a foreign copy of the platform may hold
  // the same key with plans whose fields are not the ones this release writes.
  // Nothing may throw — this handler answers inside `Bun.serve`, where a throw
  // is a failed request — so a plan whose enhancer lists, parameter lists, and
  // handler name cannot be read is stated as the empty facts they are: no
  // guards, no binding, no name, and the mapping every compiled route carries.
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
        },
      ],
      globalEnhancers: { guards: "not a list", interceptors: null, filters: undefined },
    },
    enumerable: false,
  });

  const server = serveLoopback(application);

  try {
    expect(routeById(await readFlow(server), "GET /")).toEqual({
      id: "GET /",
      stages: [
        { id: "GET /#0", kind: "invoke", source: null, next: ["GET /#1"] },
        { id: "GET /#1", kind: "handler", controller: "ForeignController", next: [] },
      ],
      filters: [{ kind: "default", name: "ProblemDetailsMapping" }],
    });
  } finally {
    server.stop();
  }
});

test("an application no boot produced still answers, and a route no record describes publishes no filter", async () => {
  const bare = serveLoopback(new Elysia());

  try {
    // The mounted table is the application's own fact, so the endpoint answers
    // for an application this package knows nothing about — with no routes for
    // one that answers none.
    expect(await readFlow(bare)).toEqual({ routes: [] });
  } finally {
    bare.stop();
  }

  const native = new Elysia();
  native.get("/", () => "native");
  const server = serveLoopback(native);

  try {
    // One route, no stage any source states, and no filter: only the platform's
    // own compilation records the enhancers and the mapping a route carries,
    // and this route was mounted by nothing that compiled either.
    expect(await readFlow(server)).toEqual({
      routes: [{ id: "GET /", stages: [], filters: [] }],
    });
  } finally {
    server.stop();
  }
});

test("a route table this release cannot walk still answers with what it can read", async () => {
  // The table is Elysia's, not this release's, so both halves of it are what the
  // installed release holds rather than what this one expects — and this handler
  // runs inside `Bun.serve`, where a throw is a failed request. An entry this
  // release cannot join costs a route, and a hook entry carrying no identity
  // costs a stage, but neither costs the report.
  const unwalkable = serveLoopback({ routes: {} } as unknown as Elysia);

  try {
    expect(await readFlow(unwalkable)).toEqual({ routes: [] });
  } finally {
    unwalkable.stop();
  }

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

  const server = serveLoopback(application);

  try {
    // A route with no validators to name: the hooks read as no stage, and the
    // plan still states the binding and the method that serves it.
    expect(routeById(await readFlow(server), "GET /nohooks")).toEqual({
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

    const foreign = routeById(await readFlow(server), "GET /foreign");

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

    expect(routeById(await readFlow(server), "GET /slots")).toEqual({
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
  } finally {
    server.stop();
  }
});
