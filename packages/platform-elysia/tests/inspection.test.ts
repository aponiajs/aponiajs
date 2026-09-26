import { expect, test } from "bun:test";
import {
  Body,
  Controller,
  Get,
  Injectable,
  MessageBody,
  Module,
  Param,
  Post,
  Query,
  SubscribeMessage,
  WebSocketGateway,
  createToken,
  defineModule,
  provideAlias,
  provideClass,
  provideFactory,
  provideValue,
  type ControllerDefinition,
  type DynamicModule,
  type LoggerService,
  type ModuleDefinition,
} from "@aponiajs/common";
import { z } from "zod";
import {
  defineElysiaControllerRoutes,
  elysiaController,
  inspectAponiaApplication,
  type AponiaInspectionOptions,
  type AponiaModuleDescriptorArtifact,
} from "../src/index.ts";
import { aponiaVersion } from "../src/version.ts";

const inspectionCreateSchema = { body: z.object({ name: z.string().min(2) }) };

const inspectionConstructions: string[] = [];

@Injectable()
class InspectionUserService {
  constructor() {
    inspectionConstructions.push("InspectionUserService");
  }

  create(name: string): { name: string } {
    return { name };
  }
}

@Controller("inspections")
class InspectionUserController {
  constructor(private readonly userService: InspectionUserService) {
    inspectionConstructions.push("InspectionUserController");
  }

  @Post("/", inspectionCreateSchema)
  create(@Body() body: { name: string }): { name: string } {
    return this.userService.create(body.name);
  }

  @Get("zeta")
  readZeta(): string {
    return "zeta";
  }

  @Get("alpha")
  readAlpha(): string {
    return "alpha";
  }

  @Post("alpha")
  createAlpha(): string {
    return "alpha";
  }

  @Get(":id")
  find(
    @Param("id") id: string,
    @Query("expand") expand: string | undefined,
  ): { id: string; expand: string | undefined } {
    return { id, expand };
  }
}

@Module({
  providers: [InspectionUserService],
  exports: [InspectionUserService],
})
class InspectionUsersModule {}

@Module({
  imports: [InspectionUsersModule],
  controllers: [InspectionUserController],
})
class InspectionAppModule {}

const INSPECTION_CONFIG = createToken<{ readonly name: string }>("INSPECTION_CONFIG");
const INSPECTION_FACTORY = createToken<string>("INSPECTION_FACTORY");
const INSPECTION_ALIAS = createToken<InspectionOptions>("INSPECTION_ALIAS");

class InspectionOptions {
  constructor(readonly config: { readonly name: string }) {}
}

const inspectionProviderModule = defineModule({
  id: "InspectionProviderModule",
  providers: [
    provideValue(INSPECTION_CONFIG, { name: "inspection" }),
    provideClass(InspectionOptions, [INSPECTION_CONFIG] as const),
    provideFactory(
      INSPECTION_FACTORY,
      [InspectionOptions] as const,
      (options) => options.config.name,
    ),
    provideAlias(INSPECTION_ALIAS, InspectionOptions),
  ],
  exports: [INSPECTION_CONFIG],
});

const inspectionDynamicUsersModule: DynamicModule = Object.freeze({
  module: InspectionUsersModule,
  id: "InspectionUsersModule[tenant-a]",
  instanceId: Symbol("InspectionUsersModule[tenant-a]"),
  providers: Object.freeze([]),
});

@Module({ imports: [inspectionDynamicUsersModule] })
class InspectionTenantModule {}

@WebSocketGateway("/inspections-socket/")
class InspectionGateway {
  @SubscribeMessage("create")
  create(@MessageBody() data: unknown): unknown {
    return data;
  }

  @SubscribeMessage("read")
  read(): string {
    return "read";
  }

  @SubscribeMessage("remove")
  remove(): string {
    return "removed";
  }
}

@Module({ providers: [InspectionGateway] })
class InspectionGatewayModule {}

@WebSocketGateway("/inspections-bravo")
class InspectionBravoGateway {
  @SubscribeMessage("read")
  read(): string {
    return "read";
  }
}

@WebSocketGateway("/inspections-alpha")
class InspectionAlphaGateway {
  @SubscribeMessage("read")
  read(): string {
    return "read";
  }
}

@Module({ providers: [InspectionBravoGateway, InspectionAlphaGateway] })
class InspectionGatewayOrderModule {}

@WebSocketGateway("/inspections-duplicate")
class InspectionDuplicateGateway {}

@WebSocketGateway("/inspections-duplicate/")
class InspectionConflictingGateway {}

@Module({ providers: [InspectionDuplicateGateway, InspectionConflictingGateway] })
class InspectionDuplicateGatewayModule {}

const inspectionSymbolHandler = Symbol("inspectionSymbolHandler");

@Controller("inspections-symbol")
class InspectionSymbolController {
  @Get("symbol")
  [inspectionSymbolHandler](): string {
    return "symbol";
  }
}

@Module({ controllers: [InspectionSymbolController] })
class InspectionSymbolModule {}

class InspectionRegisteredController {
  read(): string {
    return "registered";
  }
}

const inspectionRegisteredController = elysiaController(
  InspectionRegisteredController,
  (application) => application.get("/inspections-registered", () => "registered"),
);

const inspectionRegisteredModule = defineModule({
  id: "InspectionRegisteredModule",
  controllers: [inspectionRegisteredController],
});

/**
 * The graph `aponia build` would declare for the root the cases below inspect.
 * Its id is not the class name the artifact is keyed by, so a case that reads it
 * can only have read the declaration rather than compared it to a lowered one.
 */
const inspectionDeclaredAppModule = defineModule({
  id: "InspectionDeclaredModule",
  providers: [provideClass(InspectionUserService, [])],
  controllers: [
    defineElysiaControllerRoutes(InspectionUserController, {
      path: "inspections-declared",
      inject: [InspectionUserService],
      routes: [
        {
          method: "GET",
          path: "ping",
          propertyKey: "readAlpha",
          promiseCapable: false,
        },
      ],
    }),
  ],
});

/** An artifact shaped the way `aponia build` writes one, stamped by this release. */
function inspectionArtifact(
  modules: Readonly<Record<string, ModuleDefinition>>,
): AponiaModuleDescriptorArtifact {
  return Object.freeze({ framework: aponiaVersion, elysia: null, modules: Object.freeze(modules) });
}

class InspectionRecordingLogger implements LoggerService {
  readonly records: { readonly context: string; readonly message: string }[] = [];

  log(message: unknown, context?: unknown): void {
    this.records.push({
      context: typeof context === "string" ? context : "",
      message: String(message),
    });
  }

  fatal(): void {}
  error(): void {}
  warn(): void {}
}

const inspectionEmptyModule = defineModule({ id: "InspectionEmptyModule" });

class InspectionCyclicFirst {}
class InspectionCyclicSecond {}
Module({ imports: [InspectionCyclicSecond] })(InspectionCyclicFirst);
Module({ imports: [InspectionCyclicFirst] })(InspectionCyclicSecond);

class InspectionUndecoratedModule {}

test("projects a decorated controller with its parameter bindings in a deterministic order", () => {
  const inspection = inspectAponiaApplication(InspectionAppModule);

  expect(inspection.rootModule).toBe("InspectionAppModule");
  expect(inspection.gateways).toEqual([]);
  expect(
    inspection.routes.map((route) => `${route.method} ${route.path} ${route.handler}`),
  ).toEqual([
    "POST /inspections create",
    "GET /inspections/:id find",
    "GET /inspections/alpha readAlpha",
    "POST /inspections/alpha createAlpha",
    "GET /inspections/zeta readZeta",
  ]);
  expect(inspection.routes.every((route) => route.controller === "InspectionUserController")).toBe(
    true,
  );
  expect(inspection.routes.every((route) => route.module === "InspectionAppModule")).toBe(true);
  expect(inspection.routes[0]?.parameters).toEqual([
    { index: 0, kind: "body", property: undefined },
  ]);
  expect(inspection.routes[1]?.parameters).toEqual([
    { index: 0, kind: "params", property: "id" },
    { index: 1, kind: "query", property: "expand" },
  ]);
});

test("inspects the decorated graph when the descriptor artifact holds no declaration for the root", () => {
  const logger = new InspectionRecordingLogger();
  const inspection = inspectAponiaApplication(InspectionAppModule, {
    descriptors: inspectionArtifact({}),
    logger,
  });

  expect(inspection).toEqual(inspectAponiaApplication(InspectionAppModule));
  expect(inspection.rootModule).toBe("InspectionAppModule");
  expect(logger.records).toContainEqual({
    context: "RoutesResolver",
    message:
      'The generated module descriptors hold no declaration for "InspectionAppModule", so it is lowered ' +
      "from its decorators instead. Run `aponia build` again.",
  });
});

test("inspects the declared graph when the descriptor artifact declares the root name", () => {
  const logger = new InspectionRecordingLogger();
  const options: AponiaInspectionOptions = {
    descriptors: inspectionArtifact({ InspectionAppModule: inspectionDeclaredAppModule }),
    logger,
  };

  const inspection = inspectAponiaApplication(InspectionAppModule, options);

  expect(inspection.rootModule).toBe("InspectionDeclaredModule");
  expect(inspection.modules.map((module) => module.id)).toEqual(["InspectionDeclaredModule"]);
  expect(inspection.routes).toEqual([
    {
      method: "GET",
      path: "/inspections-declared/ping",
      module: "InspectionDeclaredModule",
      controller: "InspectionUserController",
      handler: "readAlpha",
      parameters: [],
    },
  ]);
  expect(logger.records).toContainEqual({
    context: "RoutesResolver",
    message:
      "Booting InspectionAppModule from the generated module descriptors, so the declared graph serves " +
      "this application.",
  });
});

test("projects module graph order, imports, exports, and controller ids", () => {
  const inspection = inspectAponiaApplication(InspectionAppModule);

  expect(inspection.modules.map((module) => module.id)).toEqual([
    "InspectionUsersModule",
    "InspectionAppModule",
  ]);
  expect(inspection.modules.map((module) => module.instanceId)).toEqual([undefined, undefined]);
  expect(inspection.modules[0]?.imports).toEqual([]);
  expect(inspection.modules[0]?.controllers).toEqual([]);
  expect(inspection.modules[0]?.providers).toEqual([
    { token: "InspectionUserService", kind: "class", dependencies: [] },
  ]);
  expect(inspection.modules[0]?.exports).toEqual(["InspectionUserService"]);
  expect(inspection.modules[1]?.imports).toEqual(["InspectionUsersModule"]);
  expect(inspection.modules[1]?.controllers).toEqual(["InspectionUserController"]);
  expect(inspection.modules[1]?.providers).toEqual([]);
  expect(inspection.modules[1]?.exports).toEqual([]);
});

test("projects every provider kind with the dependencies the container resolves", () => {
  const inspection = inspectAponiaApplication(inspectionProviderModule);

  expect(inspection.modules[0]?.providers).toEqual([
    { token: "INSPECTION_CONFIG", kind: "value", dependencies: [] },
    { token: "InspectionOptions", kind: "class", dependencies: ["INSPECTION_CONFIG"] },
    { token: "INSPECTION_FACTORY", kind: "factory", dependencies: ["InspectionOptions"] },
    { token: "INSPECTION_ALIAS", kind: "alias", dependencies: ["InspectionOptions"] },
  ]);
  expect(inspection.modules[0]?.exports).toEqual(["INSPECTION_CONFIG"]);
  expect(inspection.rootModule).toBe("InspectionProviderModule");
});

test("projects the configured instance identity of a dynamic module", () => {
  const inspection = inspectAponiaApplication(InspectionTenantModule);

  expect(inspection.rootModule).toBe("InspectionTenantModule");
  expect(inspection.modules.map((module) => module.id)).toEqual([
    "InspectionUsersModule[tenant-a]",
    "InspectionTenantModule",
  ]);
  expect(inspection.modules[0]?.instanceId).toBe("Symbol(InspectionUsersModule[tenant-a])");
  expect(inspection.modules[1]?.instanceId).toBeUndefined();
  expect(inspection.modules[1]?.imports).toEqual(["InspectionUsersModule[tenant-a]"]);
});

test("projects a WebSocket gateway with its subscribed events in declaration order", () => {
  const inspection = inspectAponiaApplication(InspectionGatewayModule);

  expect(inspection.gateways).toEqual([
    {
      module: "InspectionGatewayModule",
      token: "InspectionGateway",
      path: "/inspections-socket",
      events: ["create", "read", "remove"],
    },
  ]);
  expect(inspection.routes).toEqual([]);
});

test("sorts gateways by canonical path regardless of declaration order", () => {
  const inspection = inspectAponiaApplication(InspectionGatewayOrderModule);

  expect(inspection.gateways.map((gateway) => gateway.path)).toEqual([
    "/inspections-alpha",
    "/inspections-bravo",
  ]);
  expect(inspection.gateways.map((gateway) => gateway.token)).toEqual([
    "InspectionAlphaGateway",
    "InspectionBravoGateway",
  ]);
});

test("returns empty collections for an application without controllers or gateways", () => {
  const inspection = inspectAponiaApplication(inspectionEmptyModule);

  expect(inspection).toEqual({
    rootModule: "InspectionEmptyModule",
    modules: [
      {
        id: "InspectionEmptyModule",
        instanceId: undefined,
        imports: [],
        controllers: [],
        providers: [],
        exports: [],
      },
    ],
    routes: [],
    gateways: [],
  });
});

test("returns deeply equal data for repeated inspections of one root module", () => {
  const first = inspectAponiaApplication(InspectionAppModule);
  const second = inspectAponiaApplication(InspectionAppModule);

  expect(first).toEqual(second);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});

test("returns deeply frozen inspection data", () => {
  const inspection = inspectAponiaApplication(InspectionGatewayModule);

  expect(isDeeplyFrozen(inspection)).toBe(true);
});

test("projects a symbol-keyed handler as its Symbol description", () => {
  const inspection = inspectAponiaApplication(InspectionSymbolModule);

  expect(inspection.routes.map((route) => route.handler)).toEqual([
    "Symbol(inspectionSymbolHandler)",
  ]);
  expect(inspection.routes[0]?.path).toBe("/inspections-symbol/symbol");
});

test("inspects without constructing a provider or a controller", () => {
  inspectionConstructions.length = 0;

  const inspection = inspectAponiaApplication(InspectionAppModule);

  expect(inspectionConstructions).toEqual([]);
  expect(inspection.routes).toHaveLength(5);
});

test("lists a directly registered controller without inventing routes", () => {
  const inspection = inspectAponiaApplication(inspectionRegisteredModule);

  expect(inspection.modules[0]?.controllers).toEqual(["InspectionRegisteredController"]);
  expect(inspection.modules[0]?.providers).toEqual([]);
  expect(inspection.routes).toEqual([]);
});

test("returns a JSON document that never leaks a symbol, function, or validator", () => {
  const inspection = inspectAponiaApplication(InspectionAppModule);
  const serialized = JSON.stringify(inspection);

  expect(serialized).not.toContain("useFactory");
  expect(serialized).not.toContain("useClass");
  expect(serialized).not.toContain("~standard");
  expect(JSON.parse(serialized)).toStrictEqual({
    rootModule: "InspectionAppModule",
    modules: [
      {
        id: "InspectionUsersModule",
        imports: [],
        controllers: [],
        providers: [{ token: "InspectionUserService", kind: "class", dependencies: [] }],
        exports: ["InspectionUserService"],
      },
      {
        id: "InspectionAppModule",
        imports: ["InspectionUsersModule"],
        controllers: ["InspectionUserController"],
        providers: [],
        exports: [],
      },
    ],
    routes: [
      {
        method: "POST",
        path: "/inspections",
        module: "InspectionAppModule",
        controller: "InspectionUserController",
        handler: "create",
        parameters: [{ index: 0, kind: "body" }],
      },
      {
        method: "GET",
        path: "/inspections/:id",
        module: "InspectionAppModule",
        controller: "InspectionUserController",
        handler: "find",
        parameters: [
          { index: 0, kind: "params", property: "id" },
          { index: 1, kind: "query", property: "expand" },
        ],
      },
      {
        method: "GET",
        path: "/inspections/alpha",
        module: "InspectionAppModule",
        controller: "InspectionUserController",
        handler: "readAlpha",
        parameters: [],
      },
      {
        method: "POST",
        path: "/inspections/alpha",
        module: "InspectionAppModule",
        controller: "InspectionUserController",
        handler: "createAlpha",
        parameters: [],
      },
      {
        method: "GET",
        path: "/inspections/zeta",
        module: "InspectionAppModule",
        controller: "InspectionUserController",
        handler: "readZeta",
        parameters: [],
      },
    ],
    gateways: [],
  });
});

test("rejects a class without module metadata with INVALID_MODULE", () => {
  expect(() => inspectAponiaApplication(InspectionUndecoratedModule)).toThrow(
    expect.objectContaining({ code: "INVALID_MODULE" }),
  );
});

test("rejects an import cycle with MODULE_CYCLE", () => {
  expect(() => inspectAponiaApplication(InspectionCyclicFirst)).toThrow(
    expect.objectContaining({ code: "MODULE_CYCLE" }),
  );
});

test("rejects a controller from another platform with UNSUPPORTED_CONTROLLER", () => {
  class InspectionForeignController {}
  const controller: ControllerDefinition = {
    kind: "foreign.controller",
    token: InspectionForeignController,
    inject: [],
    useClass: InspectionForeignController,
  };
  const module = defineModule({
    id: "InspectionForeignControllerModule",
    controllers: [controller],
  });

  expect(() => inspectAponiaApplication(module)).toThrow(
    expect.objectContaining({ code: "UNSUPPORTED_CONTROLLER" }),
  );
});

test("rejects duplicate gateway paths with DUPLICATE_WEBSOCKET_GATEWAY", () => {
  expect(() => inspectAponiaApplication(InspectionDuplicateGatewayModule)).toThrow(
    expect.objectContaining({ code: "DUPLICATE_WEBSOCKET_GATEWAY" }),
  );
});

function isDeeplyFrozen(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return true;
  }
  if (!Object.isFrozen(value)) {
    return false;
  }

  return Object.values(value).every((nested) => isDeeplyFrozen(nested));
}
