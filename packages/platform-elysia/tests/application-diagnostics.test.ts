import { expect, test } from "bun:test";
import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  UseInterceptors,
  Validation,
  defineModule,
  type ClassToken,
  type DynamicModule,
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
 * The two shapes one interceptor half is written in: a prototype method, which
 * every class token carries, and a class field, which only the instance does.
 *
 * The record has to state both, because the platform calls
 * `interceptor.interceptBefore?.(…)` on the instance — a half declared as a
 * field is an own property no token can be read for. The third class declares
 * one half only, so a reader that assumed both halves from a resolved class is
 * visible rather than agreeing with the cases that declare both.
 */
class MethodHalvesInterceptor {
  interceptBefore(): void {}

  interceptAfter(_context: unknown, response: unknown): unknown {
    return response;
  }
}

class FieldHalvesInterceptor {
  interceptBefore = (): void => {};

  interceptAfter = (_context: unknown, response: unknown): unknown => response;
}

class BeforeOnlyFieldInterceptor {
  interceptBefore = (): void => {};
}

@Controller()
class InterceptorDiagnosticsController {
  @Get("first")
  @UseInterceptors(MethodHalvesInterceptor)
  first(): string {
    return "first";
  }

  @Get("second")
  @UseInterceptors(FieldHalvesInterceptor, BeforeOnlyFieldInterceptor)
  second(): string {
    return "second";
  }
}

@Module({
  controllers: [InterceptorDiagnosticsController],
  providers: [MethodHalvesInterceptor, FieldHalvesInterceptor, BeforeOnlyFieldInterceptor],
})
class InterceptorDiagnosticsAppModule {}

/**
 * A controller whose routes throw values the platform's own mapping answers, so
 * the boot records what the exception said where the after-response hook that
 * reports the request can read it. One value is an ordinary `Error`; the other
 * refuses to be projected into a string at all, which is the case that decides
 * whether this record can cost the application its answer.
 */
@Controller()
class FailingDiagnosticsController {
  @Get("explodes")
  explode(): never {
    throw new Error("the connection string was rejected");
  }

  @Get("unprojectable")
  unprojectable(): never {
    const refusal: Record<string, unknown> = {
      [Symbol.toPrimitive](): string {
        throw new Error("this value refuses to be projected");
      },
    };
    // Cyclic as well as refusing to be coerced, so both halves of the projection
    // this release restates fail on it: `JSON.stringify` refuses the cycle, and
    // the string form refuses the coercion.
    refusal.self = refusal;

    throw refusal;
  }

  @Get("throws-string")
  throwsString(): never {
    throw "the connection string was rejected as a string";
  }

  @Get("throws-function")
  throwsFunction(): never {
    throw function namedRefusal(): never {
      throw new Error("never reached: the throw above is the failure under test");
    };
  }

  @Get("throws-object")
  throwsObject(): never {
    throw { code: "E_CONN", retries: 3 };
  }
}

@Module({ controllers: [FailingDiagnosticsController] })
class FailingDiagnosticsModule {}

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

test("the record states which interceptor halves each resolved class implements", async () => {
  // The halves a class implements are legible only while the instance that
  // implements them is in hand, so the boot records them where each declaration
  // resolves: a field-declared half is an own property of the instance and the
  // class token a plan carries never states it. One interceptor is declared both
  // globally and on a route, so this case also holds the record to one entry per
  // class rather than one per scope.
  const application = await AponiaFactory.create(InterceptorDiagnosticsAppModule, {
    logger: false,
    interceptors: [MethodHalvesInterceptor],
  });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());
  const halves = diagnostics?.interceptorHalves;

  expect(halves).toBeInstanceOf(Map);
  // The premise first: an empty map would satisfy every lookup below by
  // answering `undefined`, so the size and the key order are asserted before the
  // entries are.
  expect(halves?.size).toBe(3);
  expect([...(halves?.keys() ?? [])]).toEqual([
    MethodHalvesInterceptor,
    FieldHalvesInterceptor,
    BeforeOnlyFieldInterceptor,
  ]);
  expect(halves?.get(MethodHalvesInterceptor)).toEqual({ before: true, after: true });
  expect(halves?.get(FieldHalvesInterceptor)).toEqual({ before: true, after: true });
  expect(halves?.get(BeforeOnlyFieldInterceptor)).toEqual({ before: true, after: false });
  // The prototype the token's method-declared half lives on, and the own
  // properties the field-declared ones live on instead: this is the difference
  // that makes the record the only source for the second shape.
  expect(typeof MethodHalvesInterceptor.prototype.interceptBefore).toBe("function");
  expect(Object.hasOwn(FieldHalvesInterceptor.prototype, "interceptBefore")).toBe(false);
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
  // The one field that is deliberately not frozen, because it is not a decision
  // the boot made: the map keeps receiving the exception the mapping answers.
  expect(Object.isFrozen(diagnostics?.mappedExceptions)).toBe(false);
  await application.close();
});

test("the record carries the exception the mapping answered an unhandled failure with", async () => {
  const application = await AponiaFactory.create(FailingDiagnosticsModule, { logger: false });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());
  const request = new Request("http://localhost/explodes");

  const response = await application.handle(request);
  await response.text();

  // The premise first: the boot's own mapping answered this request, and the
  // record exposes the map it writes into.
  expect(response.status).toBe(500);
  expect(diagnostics?.mappedExceptions).toBeInstanceOf(WeakMap);
  // Keyed by the request object the mapping saw — the one the caller handed
  // `handle` — because that is the object the after-response hook looks the
  // message up by, and the projection is the one `/logs` states for the same
  // exception: the name and the message, never the stack.
  expect(diagnostics?.mappedExceptions.get(request)).toBe(
    "Error: the connection string was rejected",
  );
  await application.close();
});

test("an exception this platform cannot project leaves the mapping's answer unchanged", async () => {
  const application = await AponiaFactory.create(FailingDiagnosticsModule, { logger: false });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());
  const request = new Request("http://localhost/unprojectable");

  const response = await application.handle(request);
  const body = await response.text();

  // The premise is the answer itself: a projection that threw inside Elysia's
  // error path would replace this Problem Details response with the engine's own
  // page, which is the one outcome an observer may never cause.
  expect(response.status).toBe(500);
  expect(body).toContain("The server could not complete this request.");
  // The value is recorded as the literal both surfaces state it as, rather than
  // as an absent entry: nothing here may throw, and a thrown value that refuses
  // both the JSON form and the plain string form is a value this release cannot
  // state — which is a fact worth recording, not one worth hiding behind an
  // absence that would read as "the log stream never saw this failure either".
  expect(diagnostics?.mappedExceptions.get(request)).toBe("[unprojectable]");
  await application.close();
});

test("a thrown value that is not an Error is recorded in the projection's own form", async () => {
  const application = await AponiaFactory.create(FailingDiagnosticsModule, { logger: false });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());
  // One case per branch the projection restates, so a restatement that agreed
  // with the log stream on its `Error` case alone could not pass here.
  const cases = [
    { path: "/throws-string", expected: "the connection string was rejected as a string" },
    { path: "/throws-function", expected: "namedRefusal" },
    { path: "/throws-object", expected: '{"code":"E_CONN","retries":3}' },
  ];

  for (const expected of cases) {
    const request = new Request(`http://localhost${expected.path}`);
    const response = await application.handle(request);
    await response.text();

    // The premise first: a projection that threw would have replaced this answer
    // with the engine's own page, so the assertion below would then be reading a
    // failure rather than a projection.
    expect(response.status).toBe(500);
    expect(diagnostics?.mappedExceptions.get(request)).toBe(expected.expected);
  }

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
  // The exception map is one boot's too: two applications never share one, so
  // what one recorded cannot be read out of the other's record.
  expect(firstDiagnostics?.mappedExceptions).not.toBe(secondDiagnostics?.mappedExceptions);
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
