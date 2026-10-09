import { expect, test } from "bun:test";
import {
  Controller,
  Get,
  Module,
  Param,
  SubscribeMessage,
  WebSocketGateway,
  defineModule,
  type ClassToken,
  type ModuleDefinition,
  type LoggerService,
} from "@aponiajs/common";
import {
  AponiaFactory,
  defineController,
  defineControllerRoutes,
  controller,
  type ControllerHandlerFactory,
  type AponiaInvokerArtifact,
  type RouteHandler,
} from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import {
  aponiaVersion,
  devtoolsPathPrefix,
  handleDevtoolsRequest,
  type AponiaRoutesPayload,
} from "../src/index.ts";
// The handler record the mounted route answers through, from the module that owns
// it rather than the barrel: the surface is a route an application mounts, and
// this is the pair that route calls.
import { createHandlers } from "../src/server/devtools-server.ts";

/**
 * The mounted-route endpoint. Every case asks the pair the mounted route calls —
 * `createHandlers` and `handleDevtoolsRequest` — in process, and the payload assertions
 * are the wire shape rather than the builder's internals.
 *
 * They are called directly rather than through `application.handle` because
 * several fixtures here are bare `Elysia` instances, foreign records, or objects
 * the case assembles by hand, which could not carry a mount. The mount itself is
 * pinned over `application.handle` in `devtools-module.test.ts`, and the
 * dispatcher's `404` and `405` in `server.test.ts`.
 *
 * What these cases pin beyond the field names is where each answer comes from.
 * The routes are the application's own table, read when the request arrives —
 * a route mounted after the boot has to appear. The names beside each route are
 * the boot's, so an application that no record describes still reports its
 * routes and states what it does not know. And `source` is the boot's own
 * decision, which no single boot can demonstrate on its own: a case that only
 * ever observed one of the two states could not tell a per-route decision from
 * a per-boot one, so one application mounts both and answers for both.
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

async function readRoutes(application: Elysia): Promise<AponiaRoutesPayload> {
  const response = await ask(application, "/routes");

  expect(response.status).toBe(200);

  return (await response.json()) as AponiaRoutesPayload;
}

@Controller()
class RoutesController {
  @Get()
  read(): string {
    return "read";
  }

  @Get("messages/:id")
  readMessage(@Param("id") id: string): string {
    return id;
  }
}

@WebSocketGateway("/routes-socket")
class RoutesGateway {
  @SubscribeMessage("ping")
  ping(): string {
    return "pong";
  }
}

@Module({ controllers: [RoutesController] })
class RoutesAppModule {}

@Module({ controllers: [RoutesController], providers: [RoutesGateway] })
class RoutesGatewayModule {}

/**
 * Two controllers, one supplied invoker: the artifact covers the first
 * controller's handler and says nothing about the second's, so one boot mounts
 * both bindings. Both handlers answer the same string as each other and a third
 * string as the invoker, so a case can prove which binding actually served each
 * route rather than reading the claim back.
 */
class GeneratedRoutesController {
  read(): string {
    return "runtime binding";
  }
}

class CompiledRoutesController {
  read(): string {
    return "runtime binding";
  }
}

const twoSourceModule: ModuleDefinition = defineModule({
  id: "TwoSourceRoutesModule",
  controllers: [
    defineControllerRoutes(GeneratedRoutesController, {
      path: "generated",
      routes: [{ method: "GET", path: "/", propertyKey: "read", promiseCapable: false }],
    }),
    defineControllerRoutes(CompiledRoutesController, {
      path: "compiled",
      routes: [{ method: "GET", path: "/", propertyKey: "read", promiseCapable: false }],
    }),
  ],
});

/** An invoker artifact shaped the way `aponia build` writes one. */
function invokerArtifact(
  invokers: ReadonlyMap<ClassToken<unknown>, ControllerHandlerFactory>,
): AponiaInvokerArtifact {
  return Object.freeze({ framework: aponiaVersion, elysia: null, invokers });
}

const generatedBindingArtifact = invokerArtifact(
  new Map<ClassToken<unknown>, ControllerHandlerFactory>([
    [
      GeneratedRoutesController,
      () => new Map<string | symbol, RouteHandler>([["read", () => "generated binding"]]),
    ],
  ]),
);

/**
 * A controller whose route a callback mounts from its instance. The platform
 * compiled no plan for it, so the mounted table is the only place its method and
 * path exist and the boot is the only place the controller that mounted it does.
 */
class CallbackRoutesController {
  greet(): string {
    return "callback";
  }
}

const callbackRoutesModule: ModuleDefinition = defineModule({
  id: "CallbackRoutesModule",
  controllers: [
    controller(CallbackRoutesController, (application, controller) => {
      application.get("/callback", () => controller.greet());
      return application;
    }),
  ],
});

/**
 * A controller whose route a plugin mounts, which the boot records the same way
 * for the same reason: neither path compiles a plan the record could read.
 */
class PluginRoutesController {
  greet(): string {
    return "plugin";
  }
}

const pluginRoutesModule: ModuleDefinition = defineModule({
  id: "PluginRoutesModule",
  controllers: [
    defineController(PluginRoutesController, {
      inject: [] as const,
      buildPlugin: (controller) => new Elysia().get("/plugin", () => controller.greet()),
    }),
  ],
});

test("routes reports every mounted route with the binding that serves it", async () => {
  const application = await AponiaFactory.createNative(RoutesAppModule, { logger: false });
  const response = await ask(application, "/routes");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toBe("no-store");

  const payload = await readRoutes(application);

  expect(payload.routes.map((route) => route.path)).toContain("/");
  expect(
    payload.routes.every(({ source }) => source === "generated" || source === "compiled"),
  ).toBe(true);

  // One assertion for the whole wire shape, so a field added or renamed here
  // fails rather than passing under a per-field read. No artifact was
  // supplied, so every route is the platform's own compilation, and the second
  // route's bound field is what a plan adds to a route the table can describe
  // only as a method and a path.
  expect(payload).toEqual({
    routes: [
      {
        method: "GET",
        path: "/",
        module: "RoutesAppModule",
        controller: "RoutesController",
        handler: "read",
        source: "compiled",
        parameters: [],
      },
      {
        method: "GET",
        path: "/messages/:id",
        module: "RoutesAppModule",
        controller: "RoutesController",
        handler: "readMessage",
        source: "compiled",
        parameters: [{ index: 0, kind: "params", property: "id" }],
      },
    ],
  });
});

test("routes reports both bindings from the one boot that mounted them", async () => {
  const application = await AponiaFactory.createNative(twoSourceModule, {
    logger: false,
    invokers: generatedBindingArtifact,
  });
  const payload = await readRoutes(application);

  expect(payload.routes.map((route) => [route.path, route.source])).toEqual([
    ["/compiled", "compiled"],
    ["/generated", "generated"],
  ]);

  // The report has to agree with the binding that answered, which is why one
  // case mounts both: the generated route answers with the invoker's string
  // while its own method answers with another, and the compiled route answers
  // with its method's.
  expect(await (await application.handle(new Request("http://localhost/generated"))).text()).toBe(
    "generated binding",
  );
  expect(await (await application.handle(new Request("http://localhost/compiled"))).text()).toBe(
    "runtime binding",
  );
});

test("a route a controller's callback mounted is reported without a handler name", async () => {
  const application = await AponiaFactory.createNative(callbackRoutesModule, { logger: false });
  const payload = await readRoutes(application);

  // The mounted table knows the route's method and path and nothing else, and
  // the property key that built it exists only while the callback runs: the
  // report states the controller that mounted it and leaves the handler empty
  // rather than guessing a name.
  expect(payload.routes).toEqual([
    {
      method: "GET",
      path: "/callback",
      module: "CallbackRoutesModule",
      controller: "CallbackRoutesController",
      handler: "",
      source: "compiled",
      parameters: [],
    },
  ]);
  expect(await (await application.handle(new Request("http://localhost/callback"))).text()).toBe(
    "callback",
  );
});

test("a route a controller's plugin mounted is reported the same way", async () => {
  const application = await AponiaFactory.createNative(pluginRoutesModule, { logger: false });
  const payload = await readRoutes(application);

  // The other half of the same platform decision: a low-level descriptor
  // builds its plugin from an instance, so no plan exists for its routes
  // either, and both mount paths are recorded by the boot the same way.
  expect(payload.routes).toEqual([
    {
      method: "GET",
      path: "/plugin",
      module: "PluginRoutesModule",
      controller: "PluginRoutesController",
      handler: "",
      source: "compiled",
      parameters: [],
    },
  ]);
  expect(await (await application.handle(new Request("http://localhost/plugin"))).text()).toBe(
    "plugin",
  );
});

test("routes reads the mounted table when it is asked, not when the surface mounted", async () => {
  const application = await AponiaFactory.createNative(RoutesAppModule, { logger: false });
  const before = await readRoutes(application);
  expect(before.routes.map((route) => route.path)).not.toContain("/mounted-later");

  // A route mounted on the native application after the boot — the escape
  // hatch an application reaches for before it listens — is a route the
  // application answers, and a record built once would report a table the
  // application no longer holds.
  application.get("/mounted-later", () => "later");

  const after = await readRoutes(application);
  expect(after.routes.filter((route) => route.path === "/mounted-later")).toEqual([
    {
      method: "GET",
      path: "/mounted-later",
      module: "",
      controller: "",
      handler: "",
      source: null,
      parameters: [],
    },
  ]);
  expect(
    await (await application.handle(new Request("http://localhost/mounted-later"))).text(),
  ).toBe("later");
});

test("a route no boot recorded reports the table's own facts and nothing else", async () => {
  const application = await AponiaFactory.createNative(RoutesGatewayModule, { logger: false });
  const payload = await readRoutes(application);
  const sockets = payload.routes.filter(({ method }) => method === "WS");

  // A gateway's route is mounted by the platform and named by no plan and no
  // callback, so it is reported with the method the table carries and every
  // name left empty. Dropping it would make the report disagree with the
  // application, and naming anything would be a guess.
  expect(sockets).toEqual([
    {
      method: "WS",
      path: "/routes-socket",
      module: "",
      controller: "",
      handler: "",
      source: null,
      parameters: [],
    },
  ]);
});

test("an application no boot produced still reports the routes it answers", async () => {
  const bare = new Elysia();
  // The mounted table is the application's own fact, so the endpoint answers
  // for an application this package knows nothing about — with an empty table
  // for one that answers no routes.
  expect(await readRoutes(bare)).toEqual({ routes: [] });

  const native = new Elysia();
  native.get("/", () => "native");
  expect((await readRoutes(native)).routes).toEqual([
    {
      method: "GET",
      path: "/",
      module: "",
      controller: "",
      handler: "",
      source: null,
      parameters: [],
    },
  ]);
});

test("a record from a copy of the platform older than the binding state still names its plans", async () => {
  // The record is read through a registry-global symbol key, so a boot run by an
  // older copy of `@aponiajs/platform-elysia` in this process is reachable from
  // here — and that copy's plans carry no `source`, while its record has no
  // `callbackRoutes` at all. The route table is still the application's, so the
  // endpoint answers with what the record does hold and states `null` for the
  // binding it does not, rather than reporting a state no boot decided.
  const application = new Elysia();
  application.get("/", () => "older");
  Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
    value: {
      framework: "0.0.0-older",
      graph: "decorated",
      invokers: { accepted: false, reason: undefined },
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

  expect((await readRoutes(application)).routes).toEqual([
    {
      method: "GET",
      path: "/",
      module: "OlderModule",
      controller: "OlderController",
      handler: "read",
      source: null,
      parameters: [],
    },
  ]);
});

test("a record whose plans are not the shape this release writes still answers", async () => {
  // The other side of the version skew: a foreign copy of the platform may hold
  // the same key with collections this release cannot walk and a plan whose
  // fields are not the ones it writes. This build runs on the request path,
  // where a throw is that request's failure — so a plan it cannot name a handler
  // for, a parameter list it cannot read, and a binding state it does not write
  // are stated as the empty facts they are rather than as a reason to fail the
  // request.
  const application = new Elysia();
  application.get("/", () => "foreign");
  Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
    value: {
      framework: "9.9.9",
      routes: [
        {
          module: "ForeignModule",
          controller: "ForeignController",
          route: { method: "GET", path: "/", propertyKey: 7, parameters: "not a list" },
          // A binding state outside this release's three values is reported as
          // the absence rather than republished: `null` never means "an unknown
          // binding", and a foreign value would be exactly that.
          source: "not a binding",
        },
      ],
      callbackRoutes: "not a list",
    },
    enumerable: false,
  });

  expect((await readRoutes(application)).routes).toEqual([
    {
      method: "GET",
      path: "/",
      module: "ForeignModule",
      controller: "ForeignController",
      handler: "",
      source: null,
      parameters: [],
    },
  ]);
});

test("a parameter list this release cannot fully read reports what it can read", async () => {
  // The list is the record's, and both endpoints publish it: an entry is
  // republished only when it states the fields this release writes — an index
  // that is a number and a kind the decorators declare — and an entry it cannot
  // read is dropped rather than reported as an argument the route never bound.
  const application = new Elysia();
  application.get("/", () => "parameters");
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
            propertyKey: "read",
            parameters: [
              { index: 0, kind: "params", property: "id" },
              { index: "one", kind: "params" },
              { index: 1, kind: "not a kind" },
              { index: 2, kind: "body", property: 7 },
              "not a parameter",
            ],
          },
        },
      ],
    },
    enumerable: false,
  });

  expect((await readRoutes(application)).routes).toEqual([
    {
      method: "GET",
      path: "/",
      module: "ForeignModule",
      controller: "ForeignController",
      handler: "read",
      source: null,
      // A property that is not a string reads as no property, which is the
      // shape a binding that names none already has.
      parameters: [
        { index: 0, kind: "params", property: "id" },
        { index: 2, kind: "body", property: undefined },
      ],
    },
  ]);
});

test("a route table this release cannot walk is reported as no routes, not a failure", async () => {
  // The table is Elysia's, not this release's: an installed release that exposed
  // it as something other than the array this release reads — or as an array
  // holding entries this release cannot join — must leave the endpoint
  // answering. This handler runs on the request path, where a throw is a failed
  // request, and a surface that failed one endpoint would have failed the
  // debugging aid it exists to be.
  const unwalkable = { routes: {} } as unknown as Elysia;
  expect(await readRoutes(unwalkable)).toEqual({ routes: [] });

  // The same refusal one level down: an entry whose method or path is not a
  // string cannot be joined to a record entry or reported as a route, and is
  // dropped rather than rendered as one.
  const malformed = {
    routes: [
      { method: 7, path: null },
      { method: "GET", path: "/foreign" },
    ],
  } as unknown as Elysia;
  expect((await readRoutes(malformed)).routes).toEqual([
    {
      method: "GET",
      path: "/foreign",
      module: "",
      controller: "",
      handler: "",
      source: null,
      parameters: [],
    },
  ]);
});

test("routes answers in a deterministic order that does not depend on mount order", async () => {
  // Mounted in the reverse of the order the payload states, so an endpoint that
  // published the table as the application holds it would answer the other way
  // round. The controller's routes sort by path, and the third route sorts first
  // for the same reason: `path` is the outermost key of the five. The two
  // `/alpha` routes are mounted `POST` before `GET` while the payload states
  // `GET` before `POST`, so the second key is exercised rather than assumed —
  // a payload that compared only paths would keep the order they were mounted in.
  const application = new Elysia();
  application.get("/zeta", () => "zeta");
  application.post("/alpha", () => "alpha");
  application.get("/alpha", () => "alpha");
  const payload = await readRoutes(application);

  expect(payload.routes.map((route) => [route.path, route.method])).toEqual([
    ["/alpha", "GET"],
    ["/alpha", "POST"],
    ["/zeta", "GET"],
  ]);
  // Two polls of one application state the same order.
  expect((await readRoutes(application)).routes.map((route) => route.path)).toEqual(
    payload.routes.map((route) => route.path),
  );
});
