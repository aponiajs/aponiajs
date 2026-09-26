import { expect, test } from "bun:test";
import {
  Body,
  Controller,
  Get,
  Logger,
  Module,
  Post,
  Validation,
  defineModule,
  type ClassToken,
  type DynamicModule,
  type LoggerService,
  type ModuleDefinition,
  type RouteSchema,
} from "@aponiajs/common";
import { Elysia, t } from "elysia";
import {
  AponiaFactory,
  defineElysiaController,
  defineElysiaControllerRoutes,
  elysiaController,
  readApplicationDiagnostics,
  type AponiaControllerInvokerFactory,
  type AponiaInvokerArtifact,
  type AponiaModuleDescriptorArtifact,
  type AponiaRouteInvoker,
} from "../src/index.ts";
import { aponiaVersion } from "../src/version.ts";

/**
 * The boot's own record, which every later devtools endpoint reads. These cases
 * pin what the seam exposes, both branches of each decision it carries, and the
 * property of the seam a consumer relies on: it is invisible to code that walks
 * an Elysia instance.
 */

const createMessageValidator = t.Object({ text: t.String({ minLength: 1 }) });

@Validation(createMessageValidator)
class CreateMessage {
  declare readonly text: string;
}

const createMessageSchema = { body: CreateMessage } satisfies RouteSchema;

@Controller()
class DiagnosticsController {
  @Get()
  read(): string {
    return "read";
  }

  @Post("messages", createMessageSchema)
  create(@Body() body: CreateMessage): { readonly text: string } {
    return { text: body.text };
  }
}

class DiagnosticsGuard {
  canActivate(): boolean {
    return true;
  }
}

@Module({ controllers: [DiagnosticsController], providers: [DiagnosticsGuard] })
class DiagnosticsAppModule {}

/**
 * A controller whose routes are built by a callback that needs an instance, so
 * the platform never compiled a plan for it. `/routes` has to report nothing
 * for it rather than guess, and this module is what states that.
 */
class PluginOnlyDiagnosticsController {
  greet(): string {
    return "plugin";
  }
}

const pluginOnlyController = defineElysiaController(PluginOnlyDiagnosticsController, {
  inject: [] as const,
  buildPlugin: (controller) => new Elysia().get("/plugin-only", () => controller.greet()),
});

/**
 * A module that is already a descriptor, which is the only shape a controller
 * definition can be declared in: a decorated module's `controllers` are classes
 * it lowers itself.
 */
const pluginOnlyDiagnosticsModule: ModuleDefinition = defineModule({
  id: "PluginOnlyDiagnosticsModule",
  controllers: [pluginOnlyController],
});

/**
 * A controller whose routes a registration callback builds from its instance.
 * It carries no plan, so the boot has to record the routes it mounted beside the
 * controller that mounted them rather than leaving the two unreachable.
 */
class CallbackDiagnosticsController {
  greet(): string {
    return "callback";
  }
}

const callbackDiagnosticsModule: ModuleDefinition = defineModule({
  id: "CallbackDiagnosticsModule",
  controllers: [
    elysiaController(CallbackDiagnosticsController, (application, controller) => {
      application.get("/callback-only", () => controller.greet());
      return application;
    }),
  ],
});

/**
 * Two controllers, one supplied invoker: the artifact covers the first
 * controller's handler and says nothing about the second's, so one boot mounts
 * both bindings and the record has to tell them apart. Both handlers answer, so
 * a case can prove which one actually served each route.
 */
class GeneratedBindingController {
  read(): string {
    return "compiled binding";
  }
}

class CompiledBindingController {
  read(): string {
    return "compiled binding";
  }
}

const twoSourceModule: ModuleDefinition = defineModule({
  id: "TwoSourceModule",
  controllers: [
    defineElysiaControllerRoutes(GeneratedBindingController, {
      path: "generated",
      routes: [{ method: "GET", path: "/", propertyKey: "read", promiseCapable: false }],
    }),
    defineElysiaControllerRoutes(CompiledBindingController, {
      path: "compiled",
      routes: [{ method: "GET", path: "/", propertyKey: "read", promiseCapable: false }],
    }),
  ],
});

const generatedBindingArtifact = new Map<ClassToken<unknown>, AponiaControllerInvokerFactory>([
  [
    GeneratedBindingController,
    () => new Map<string | symbol, AponiaRouteInvoker>([["read", () => "generated binding"]]),
  ],
]);

/**
 * The graph a descriptor artifact names: the same application as data, keyed by
 * the decorated class the caller boots by, with an id the decorated class does
 * not carry. A record that reported the decorated root would be reporting a
 * graph the application is not running.
 */
class DeclaredDiagnosticsController {
  read(): string {
    return "declared";
  }
}

const declaredDiagnosticsModule: ModuleDefinition = defineModule({
  id: "DeclaredDiagnosticsModule",
  controllers: [
    defineElysiaControllerRoutes(DeclaredDiagnosticsController, {
      path: "declared",
      routes: [{ method: "GET", path: "/", propertyKey: "read", promiseCapable: false }],
    }),
  ],
});

function descriptorArtifact(
  modules: Readonly<Record<string, ModuleDefinition>>,
  overrides: Partial<Pick<AponiaModuleDescriptorArtifact, "framework" | "elysia">> = {},
): AponiaModuleDescriptorArtifact {
  return Object.freeze({ framework: aponiaVersion, elysia: "1.4.30", modules, ...overrides });
}

/**
 * An invoker artifact shaped the way `aponia build` writes one. The overrides
 * exist so a case can state provenance the running platform will not accept.
 */
function invokerArtifact(
  invokers: ReadonlyMap<ClassToken<unknown>, AponiaControllerInvokerFactory>,
  overrides: Partial<Pick<AponiaInvokerArtifact, "framework" | "elysia">> = {},
): AponiaInvokerArtifact {
  return Object.freeze({ framework: aponiaVersion, elysia: "1.4.30", invokers, ...overrides });
}

test("a booted application exposes its boot decision and compiled routes", async () => {
  const application = await AponiaFactory.create(DiagnosticsAppModule, {
    logger: false,
    guards: [DiagnosticsGuard],
  });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());

  expect(diagnostics?.graph).toBe("decorated");
  expect(diagnostics?.framework).toBe(aponiaVersion);
  expect(diagnostics?.rootModule.id).toBe("DiagnosticsAppModule");
  expect(diagnostics?.routes.map((entry) => entry.route.path)).toContain("/");
  // No artifact supplied this graph, so nothing stamped it. The record names the
  // release that wrote an artifact, never the release that is running.
  expect(diagnostics?.artifacts).toEqual({ invokers: null, descriptors: null });

  const createRoute = diagnostics?.routes.find((entry) => entry.route.method === "POST");
  expect(createRoute?.module).toBe("DiagnosticsAppModule");
  expect(createRoute?.controller).toBe("DiagnosticsController");
  expect(createRoute?.route.propertyKey).toBe("create");
  // The plan holds the model class itself: a route's schema slot is not lowered
  // until the route mounts, so the name `/flow` reports needs no new field.
  expect(createRoute?.route.schema?.body).toBe(CreateMessage);
  // The application's own declaration, which no route plan carries: a plan
  // states only what the route declares.
  expect(diagnostics?.globalEnhancers.guards).toEqual([DiagnosticsGuard]);
  expect(diagnostics?.globalEnhancers.interceptors).toEqual([]);
  expect(diagnostics?.globalEnhancers.filters).toEqual([]);
  await application.close();
});

test("a boot records the very logger the application handed it and writes through it", async () => {
  const calls: string[] = [];
  const logger: LoggerService = {
    log: (message) => void calls.push(String(message)),
    fatal: () => {},
    error: () => {},
    warn: () => {},
  };
  const application = await AponiaFactory.create(DiagnosticsAppModule, { logger });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());

  // The object itself, not a copy of it: a consumer that patches this logger
  // patches the one the platform wrote its own boot lines through, which is what
  // makes observing an application's lines possible at all.
  expect(diagnostics?.logger).toBe(logger);
  expect(calls).toContain("Starting Aponia application...");
  // The record states which object the boot chose and never makes it immutable:
  // the logger is the application's object too, and the record is not its owner.
  expect(Object.isFrozen(diagnostics?.logger)).toBe(false);
  await application.close();
});

test("a boot that named no logger records the one it built", async () => {
  const application = await AponiaFactory.create(DiagnosticsAppModule);
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());

  // No `logger` option is the default path, and the boot still built one: the
  // record is where a consumer reads what an application that named nothing logs
  // through, so "the application publishes no logger" is never a state a boot
  // can be in while it logs normally.
  expect(diagnostics?.logger).toBeInstanceOf(Logger);
  expect(typeof diagnostics?.logger?.log).toBe("function");
  await application.close();
});

test("a boot that named a level array records the logger it built for it", async () => {
  const application = await AponiaFactory.create(DiagnosticsAppModule, { logger: ["log"] });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());

  // A list of levels is a request to build a logger rather than a logger, so the
  // application holds no object to hand over — and the record still names the
  // logger the boot built, which is the only one its lines reach.
  expect(diagnostics?.logger).toBeInstanceOf(Logger);
  await application.close();
});

test("a boot that disabled its logging records no logger", async () => {
  const application = await AponiaFactory.create(DiagnosticsAppModule, { logger: false });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());

  // `null` is the decision stated as a fact: an application that turned its
  // logging off has no logger, and a record that stayed silent about it would be
  // indistinguishable from one written before this field existed.
  expect(diagnostics?.logger).toBeNull();
  await application.close();
});

test("the record handed out is frozen, one entry at a time", async () => {
  const application = await AponiaFactory.create(DiagnosticsAppModule, { logger: false });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());

  expect(Object.isFrozen(diagnostics)).toBe(true);
  expect(Object.isFrozen(diagnostics?.routes)).toBe(true);
  expect(Object.isFrozen(diagnostics?.invokers)).toBe(true);
  expect(Object.isFrozen(diagnostics?.artifacts)).toBe(true);
  // The record owns the freeze of what it was handed: the boot's own objects
  // are not the reason these are immutable.
  expect(Object.isFrozen(diagnostics?.rootModule)).toBe(true);
  expect(Object.isFrozen(diagnostics?.rootModule.controllers)).toBe(true);
  expect(Object.isFrozen(diagnostics?.rootModule.providers)).toBe(true);
  expect(Object.isFrozen(diagnostics?.globalEnhancers)).toBe(true);
  expect(Object.isFrozen(diagnostics?.globalEnhancers.guards)).toBe(true);
  expect(diagnostics?.routes.every((entry) => Object.isFrozen(entry))).toBe(true);
  expect(diagnostics?.routes.every((entry) => Object.isFrozen(entry.route))).toBe(true);
  await application.close();
});

test("an application that was never booted through the factory exposes nothing", () => {
  expect(readApplicationDiagnostics(new Elysia())).toBeUndefined();
});

test("each boot attaches its own record to its own application", async () => {
  const first = await AponiaFactory.create(DiagnosticsAppModule, { logger: false });
  const second = await AponiaFactory.create(DiagnosticsAppModule, { logger: false });
  const firstDiagnostics = readApplicationDiagnostics(first.getNativeApplication());
  const secondDiagnostics = readApplicationDiagnostics(second.getNativeApplication());

  expect(firstDiagnostics).toBeDefined();
  expect(secondDiagnostics).toBeDefined();
  expect(firstDiagnostics).not.toBe(secondDiagnostics);
  await first.close();
  await second.close();
});

test("the seam is attached as a non-enumerable own property", async () => {
  const application = await AponiaFactory.create(DiagnosticsAppModule, { logger: false });
  const nativeApplication = application.getNativeApplication();
  const diagnosticsKey = Symbol.for("aponia.application.diagnostics");

  // Non-enumerable and non-writable by construction, never by a consumer:
  // Elysia's own composition walks an instance's keys, and a record it found
  // there would become part of the application's shape.
  expect(Object.getOwnPropertyDescriptor(nativeApplication, diagnosticsKey)).toEqual({
    value: expect.anything(),
    writable: false,
    enumerable: false,
    configurable: false,
  });
  expect(Reflect.ownKeys(nativeApplication)).toContain(diagnosticsKey);
  const enumerableKeys = Reflect.ownKeys(nativeApplication).filter(
    (ownKey) => Object.getOwnPropertyDescriptor(nativeApplication, ownKey)?.enumerable === true,
  );
  expect(enumerableKeys).not.toContain(diagnosticsKey);
  await application.close();
});

test("a boot served by the descriptor artifact reports the declared graph", async () => {
  const application = await AponiaFactory.create(DiagnosticsAppModule, {
    logger: false,
    descriptors: descriptorArtifact({ DiagnosticsAppModule: declaredDiagnosticsModule }),
  });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());

  // The root the declaration names rather than the class the caller passed, and
  // the plans that mounted from that same graph. The descriptor stamp is the
  // artifact's own release, which is the fact only adoption can supply.
  expect(diagnostics?.graph).toBe("declared");
  expect(diagnostics?.rootModule.id).toBe("DeclaredDiagnosticsModule");
  expect(diagnostics?.artifacts.descriptors).toBe(aponiaVersion);
  expect(diagnostics?.routes.map((entry) => entry.route.path)).toEqual(["/declared"]);
  expect(diagnostics?.routes[0]?.module).toBe("DeclaredDiagnosticsModule");
  expect(diagnostics?.routes[0]?.controller).toBe("DeclaredDiagnosticsController");
  await application.close();
});

test("a class whose descriptor artifact was refused reports the decorated graph", async () => {
  const application = await AponiaFactory.create(DiagnosticsAppModule, {
    logger: false,
    descriptors: descriptorArtifact(
      { DiagnosticsAppModule: declaredDiagnosticsModule },
      { framework: "0.0.0", elysia: "1.0.0" },
    ),
  });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());

  // The artifact named a declared graph, and the boot refused it: a stale
  // artifact must never make the record describe a graph the application is not
  // running, so the class the caller passed is what both the record and the
  // container report. Its release stamp goes with it — the graph the record now
  // describes was written by nobody, and `0.0.0` is the artifact's, not this
  // application's.
  expect(diagnostics?.graph).toBe("decorated");
  expect(diagnostics?.rootModule.id).toBe("DiagnosticsAppModule");
  expect(diagnostics?.artifacts.descriptors).toBeNull();
  expect(diagnostics?.routes.map((entry) => entry.route.path)).toContain("/");
  await application.close();
});

test("a boot served by a dynamic module root reports the decorated graph", async () => {
  const dynamicRoot: DynamicModule = {
    module: DiagnosticsAppModule,
    id: "DynamicDiagnosticsModule",
    instanceId: Symbol("dynamic-diagnostics"),
  };
  const application = await AponiaFactory.create(dynamicRoot, { logger: false });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());

  // A dynamic module is not data the container compiles as it stands: its
  // decorators are read and lowered exactly as a class root's are, so it is the
  // decorated graph — and the id comes from the configuration, not the class.
  expect(diagnostics?.graph).toBe("decorated");
  expect(diagnostics?.rootModule.id).toBe("DynamicDiagnosticsModule");
  expect(diagnostics?.routes.map((entry) => entry.route.path)).toContain("/");
  await application.close();
});

test("a controller mounted through the low-level descriptor path contributes no route entry", async () => {
  const application = await AponiaFactory.create(pluginOnlyDiagnosticsModule, { logger: false });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());
  const response = await application.handle(new Request("http://localhost/plugin-only"));

  // The route mounted, and the record still reports no compiled plan for it: its
  // plugin built the route, so there is no plan to describe. Its mount is
  // recorded as what it is — a route the controller mounted itself, with the two
  // names the mounted table does not keep. The root is data the caller declared,
  // which is what that graph is reported as — and its descriptor stamp stays
  // `null`, because `"declared"` says the container compiled data, not that a
  // build emitted it. A hand-written descriptor was emitted by nobody.
  expect(await response.text()).toBe("plugin");
  expect(diagnostics?.graph).toBe("declared");
  expect(diagnostics?.artifacts.descriptors).toBeNull();
  expect(diagnostics?.routes).toEqual([]);
  expect(diagnostics?.callbackRoutes).toEqual([
    {
      module: "PluginOnlyDiagnosticsModule",
      controller: "PluginOnlyDiagnosticsController",
      source: "compiled",
      method: "GET",
      path: "/plugin-only",
    },
  ]);
  await application.close();
});

test("a route a registration callback mounts is reported with the controller that mounted it", async () => {
  const application = await AponiaFactory.create(callbackDiagnosticsModule, { logger: false });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());
  const response = await application.handle(new Request("http://localhost/callback-only"));

  // The callback compiled nothing for the platform to read, so the two names
  // that say who mounted this route come from the mount itself: the table grew
  // between two observations, and the controller that was mounting is the one
  // that made it grow.
  expect(await response.text()).toBe("callback");
  expect(diagnostics?.routes).toEqual([]);
  expect(diagnostics?.callbackRoutes).toEqual([
    {
      module: "CallbackDiagnosticsModule",
      controller: "CallbackDiagnosticsController",
      source: "compiled",
      method: "GET",
      path: "/callback-only",
    },
  ]);
  expect(diagnostics?.callbackRoutes.every((entry) => Object.isFrozen(entry))).toBe(true);
  await application.close();
});

test("each plan reports the binding that serves it, from one boot that mounts both", async () => {
  const application = await AponiaFactory.create(twoSourceModule, {
    logger: false,
    invokers: invokerArtifact(generatedBindingArtifact),
  });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());
  const generated = await application.handle(new Request("http://localhost/generated"));
  const compiled = await application.handle(new Request("http://localhost/compiled"));

  // One boot, two sources: a supplied invoker covers the first controller's
  // property key and not the second's, and each route answers with the binding
  // the record names it. A case that only ever mounted one of the two could not
  // tell a per-route decision from a per-boot one.
  expect(await generated.text()).toBe("generated binding");
  expect(await compiled.text()).toBe("compiled binding");
  expect(diagnostics?.routes.map((entry) => [entry.route.path, entry.source])).toEqual([
    ["/generated", "generated"],
    ["/compiled", "compiled"],
  ]);
  // Nothing mounted a route of its own here, so the other half of the table is
  // empty rather than absent.
  expect(diagnostics?.callbackRoutes).toEqual([]);
  await application.close();
});

test("a boot with no invoker artifact reports every plan as compiled binding", async () => {
  const application = await AponiaFactory.create(twoSourceModule, { logger: false });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());

  // No artifact was supplied, so nothing could have bound a route: every plan is
  // the platform's own compilation, including the controller a supplied map
  // would otherwise have covered.
  expect(diagnostics?.invokers.accepted).toBe(false);
  expect(diagnostics?.routes.map((entry) => entry.source)).toEqual(["compiled", "compiled"]);
  await application.close();
});

test("a boot that adopts no invoker artifact reports the refusal and why", async () => {
  const absent = await AponiaFactory.create(DiagnosticsAppModule, { logger: false });
  const absentDiagnostics = readApplicationDiagnostics(absent.getNativeApplication());
  expect(absentDiagnostics?.invokers.accepted).toBe(false);
  expect(absentDiagnostics?.invokers.reason).toBeDefined();
  // Nothing was adopted, so no release supplied binding this boot ran.
  expect(absentDiagnostics?.artifacts.invokers).toBeNull();
  await absent.close();

  const stale = await AponiaFactory.create(DiagnosticsAppModule, {
    logger: false,
    invokers: invokerArtifact(new Map(), { framework: "0.0.0", elysia: "1.0.0" }),
  });
  const staleDiagnostics = readApplicationDiagnostics(stale.getNativeApplication());
  expect(staleDiagnostics?.invokers.accepted).toBe(false);
  expect(staleDiagnostics?.invokers.reason).toContain("0.0.0");
  expect(staleDiagnostics?.invokers.reason).toContain(aponiaVersion);
  // The refused artifact names a release that is not running this boot, so its
  // stamp is not reported either: a refusal leaves no supplied invoker to stamp.
  expect(staleDiagnostics?.artifacts.invokers).toBeNull();
  await stale.close();

  // A JavaScript caller has no type checker, which is the state this states.
  const malformed = await AponiaFactory.create(DiagnosticsAppModule, {
    logger: false,
    invokers: {
      framework: aponiaVersion,
      elysia: null,
      invokers: undefined,
    } as unknown as AponiaInvokerArtifact,
  });
  const malformedDiagnostics = readApplicationDiagnostics(malformed.getNativeApplication());
  expect(malformedDiagnostics?.invokers.accepted).toBe(false);
  expect(malformedDiagnostics?.invokers.reason).toContain("no invoker map");
  await malformed.close();
});

test("a boot that adopts an invoker artifact reports no reason", async () => {
  const application = await AponiaFactory.create(DiagnosticsAppModule, {
    logger: false,
    invokers: invokerArtifact(new Map()),
  });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());

  expect(diagnostics?.invokers.accepted).toBe(true);
  expect(diagnostics?.invokers.reason).toBeUndefined();
  // The artifact's own release, which is what a consumer reports as the
  // provenance of the binding that served this application.
  expect(diagnostics?.artifacts.invokers).toBe(aponiaVersion);
  await application.close();
});
