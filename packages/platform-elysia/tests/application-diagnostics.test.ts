import { expect, test } from "bun:test";
import {
  Body,
  Controller,
  Get,
  Module,
  Post,
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
  readApplicationDiagnostics,
  type AponiaControllerInvokerFactory,
  type AponiaInvokerArtifact,
  type AponiaModuleDescriptorArtifact,
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

  // The route mounted, and the record still reports nothing for it: its
  // callback built the route, so there is no compiled plan to describe. The
  // root is data the caller declared, which is what that graph is reported as —
  // and its descriptor stamp stays `null`, because `"declared"` says the
  // container compiled data, not that a build emitted it. A hand-written
  // descriptor was emitted by nobody.
  expect(await response.text()).toBe("plugin");
  expect(diagnostics?.graph).toBe("declared");
  expect(diagnostics?.artifacts.descriptors).toBeNull();
  expect(diagnostics?.routes).toEqual([]);
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
