import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  SubscribeMessage,
  WebSocketGateway,
  createToken,
  defineModule,
  provideAlias,
  provideClass,
  provideValue,
  type DynamicModule,
  type RequestMethod,
  type RouteParameterKind,
} from "@aponiajs/common";
import { z } from "zod";
import {
  defineElysiaControllerRoutes,
  inspectAponiaApplication,
  type AponiaApplicationInspection,
  type AponiaApplicationOptions,
  type AponiaInspectedProviderKind,
  type AponiaInspectionOptions,
  type AponiaModuleDescriptorArtifact,
  type AponiaModuleInspection,
  type AponiaRouteInspection,
  type AponiaRouteParameterInspection,
} from "../src/index.ts";
import { aponiaVersion } from "../src/version.ts";

type VitePlusTest = typeof import("vite-plus/test");
type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type RouteMethodInspectionAssertion = Expect<
  Equals<AponiaRouteInspection["method"], RequestMethod>
>;
type RouteParameterInspectionAssertion = Expect<
  Equals<AponiaRouteParameterInspection["kind"], RouteParameterKind>
>;
type ProviderKindInspectionAssertion = Expect<
  Equals<AponiaInspectedProviderKind, "class" | "value" | "factory" | "alias">
>;
type InspectionCollectionsAssertion = Expect<
  Equals<AponiaApplicationInspection["modules"], readonly AponiaModuleInspection[]>
>;
type InspectionOptionsAssertion = Expect<
  Equals<NonNullable<Parameters<typeof inspectAponiaApplication>[1]>, AponiaInspectionOptions>
>;
type InspectionDescriptorsAssertion = Expect<
  Equals<AponiaInspectionOptions["descriptors"], AponiaModuleDescriptorArtifact | undefined>
>;
type InspectionLoggerAssertion = Expect<
  Equals<AponiaInspectionOptions["logger"], AponiaApplicationOptions["logger"]>
>;

const conformanceCreateSchema = { body: z.object({ name: z.string().min(2) }) };

@Injectable()
class ConformanceInspectionService {
  describe(): string {
    return "inspection";
  }
}

@Controller("conformance-inspection")
class ConformanceInspectionController {
  constructor(private readonly service: ConformanceInspectionService) {}

  @Post("/", conformanceCreateSchema)
  create(@Body("name") name: string): { name: string } {
    return { name };
  }

  @Get(":id")
  find(@Param("id") id: string): { id: string; service: string } {
    return { id, service: this.service.describe() };
  }
}

@Module({
  providers: [ConformanceInspectionService],
  exports: [ConformanceInspectionService],
})
class ConformanceInspectionServicesModule {}

@Module({
  imports: [ConformanceInspectionServicesModule],
  controllers: [ConformanceInspectionController],
})
class ConformanceInspectionModule {}

const CONFORMANCE_INSPECTION_CONFIG = createToken<string>("CONFORMANCE_INSPECTION_CONFIG");
const CONFORMANCE_INSPECTION_ALIAS = createToken<ConformanceInspectionHolder>(
  "CONFORMANCE_INSPECTION_ALIAS",
);

class ConformanceInspectionHolder {
  constructor(readonly config: string) {}
}

@Module({})
class ConformanceInspectionConfigModule {}

const conformanceInspectionDynamicModule: DynamicModule = Object.freeze({
  module: ConformanceInspectionConfigModule,
  id: "ConformanceInspectionConfigModule[tenant]",
  instanceId: Symbol("ConformanceInspectionConfigModule[tenant]"),
  providers: Object.freeze([
    provideValue(CONFORMANCE_INSPECTION_CONFIG, "configured"),
    provideClass(ConformanceInspectionHolder, [CONFORMANCE_INSPECTION_CONFIG] as const),
    provideAlias(CONFORMANCE_INSPECTION_ALIAS, ConformanceInspectionHolder),
  ]),
  exports: Object.freeze([]),
});

@Module({ imports: [conformanceInspectionDynamicModule] })
class ConformanceInspectionTenantModule {}

const conformanceInspectionEmptyModule = defineModule({ id: "ConformanceInspectionEmptyModule" });

@Controller("conformance-declared-inspection")
class ConformanceDeclaredInspectionController {
  @Get("ping")
  ping(): string {
    return "ping";
  }
}

/**
 * The graph `aponia build` would declare for the root above: a declared id the
 * decorated lowering cannot produce, so an inspection that reads it can only
 * have read the declaration rather than the classes the application named.
 */
const conformanceInspectionDeclaredModule = defineModule({
  id: "ConformanceInspectionDeclaredModule",
  controllers: [
    defineElysiaControllerRoutes(ConformanceDeclaredInspectionController, {
      path: "conformance-declared-inspection",
      inject: [],
      routes: [
        {
          method: "GET",
          path: "ping",
          propertyKey: "ping",
          promiseCapable: false,
        },
      ],
    }),
  ],
});

/**
 * The options an application hands its inspection: the artifact `aponia build`
 * writes, accepted exactly as it is committed, and the logger the choice is
 * reported through.
 */
const documentedInspectionOptions: AponiaInspectionOptions = {
  descriptors: Object.freeze({
    framework: aponiaVersion,
    elysia: "1.4.30",
    modules: Object.freeze({ ConformanceInspectionModule: conformanceInspectionDeclaredModule }),
  }),
};

@WebSocketGateway("/conformance-inspection")
class ConformanceInspectionGateway {
  @SubscribeMessage("create")
  create(): string {
    return "created";
  }

  @SubscribeMessage("remove")
  remove(): string {
    return "removed";
  }
}

@Module({ providers: [ConformanceInspectionGateway] })
class ConformanceInspectionGatewayModule {}

@WebSocketGateway("/conformance-inspection-bravo")
class ConformanceBravoGateway {}

@WebSocketGateway("/conformance-inspection-alpha")
class ConformanceAlphaGateway {}

@Module({ providers: [ConformanceBravoGateway, ConformanceAlphaGateway] })
class ConformanceGatewayOrderModule {}

@WebSocketGateway("/conformance-inspection")
class ConformanceDuplicateGateway {}

@Module({ providers: [ConformanceInspectionGateway, ConformanceDuplicateGateway] })
class ConformanceDuplicateGatewayModule {}

test("the Vite+ lane projects decorated routes, parameters, and validation schemas", () => {
  const inspection = inspectAponiaApplication(ConformanceInspectionModule);

  expect(inspection.rootModule).toBe("ConformanceInspectionModule");
  expect(inspection.gateways).toEqual([]);
  expect(inspection.routes).toEqual([
    {
      method: "POST",
      path: "/conformance-inspection",
      module: "ConformanceInspectionModule",
      controller: "ConformanceInspectionController",
      handler: "create",
      parameters: [{ index: 0, kind: "body", property: "name" }],
    },
    {
      method: "GET",
      path: "/conformance-inspection/:id",
      module: "ConformanceInspectionModule",
      controller: "ConformanceInspectionController",
      handler: "find",
      parameters: [{ index: 0, kind: "params", property: "id" }],
    },
  ]);
  expect(JSON.stringify(inspection)).not.toContain("~standard");
});

test("the Vite+ lane projects modules, providers, and dynamic instance identity", () => {
  const inspection = inspectAponiaApplication(ConformanceInspectionModule);
  const tenant = inspectAponiaApplication(ConformanceInspectionTenantModule);

  expect(inspection.modules.map((module) => module.id)).toEqual([
    "ConformanceInspectionServicesModule",
    "ConformanceInspectionModule",
  ]);
  expect(inspection.modules[0]?.exports).toEqual(["ConformanceInspectionService"]);
  expect(inspection.modules[1]?.imports).toEqual(["ConformanceInspectionServicesModule"]);
  expect(inspection.modules[1]?.controllers).toEqual(["ConformanceInspectionController"]);
  expect(tenant.modules.map((module) => module.id)).toEqual([
    "ConformanceInspectionConfigModule[tenant]",
    "ConformanceInspectionTenantModule",
  ]);
  expect(tenant.modules[0]?.instanceId).toBe("Symbol(ConformanceInspectionConfigModule[tenant])");
  expect(tenant.modules[0]?.providers).toEqual([
    { token: "CONFORMANCE_INSPECTION_CONFIG", kind: "value", dependencies: [] },
    {
      token: "ConformanceInspectionHolder",
      kind: "class",
      dependencies: ["CONFORMANCE_INSPECTION_CONFIG"],
    },
    {
      token: "CONFORMANCE_INSPECTION_ALIAS",
      kind: "alias",
      dependencies: ["ConformanceInspectionHolder"],
    },
  ]);
  expect(tenant.modules[1]?.imports).toEqual(["ConformanceInspectionConfigModule[tenant]"]);
});

test("the Vite+ lane projects WebSocket gateways and their subscribed events", () => {
  const inspection = inspectAponiaApplication(ConformanceInspectionGatewayModule);
  const ordered = inspectAponiaApplication(ConformanceGatewayOrderModule);

  expect(inspection.gateways).toEqual([
    {
      module: "ConformanceInspectionGatewayModule",
      token: "ConformanceInspectionGateway",
      path: "/conformance-inspection",
      events: ["create", "remove"],
    },
  ]);
  expect(inspection.routes).toEqual([]);
  expect(ordered.gateways.map((gateway) => gateway.path)).toEqual([
    "/conformance-inspection-alpha",
    "/conformance-inspection-bravo",
  ]);
});

test("the Vite+ lane returns frozen, serializable, and deterministic inspection data", () => {
  const inspectionTypes: readonly boolean[] = [
    true satisfies RouteMethodInspectionAssertion,
    true satisfies RouteParameterInspectionAssertion,
    true satisfies ProviderKindInspectionAssertion,
    true satisfies InspectionCollectionsAssertion,
  ];
  const first = inspectAponiaApplication(ConformanceInspectionModule);
  const second = inspectAponiaApplication(ConformanceInspectionModule);

  expect(inspectionTypes).toEqual([true, true, true, true]);
  expect(second).toEqual(first);
  expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  expect(deepFreezeViolation(first)).toBeUndefined();
  expect(JSON.parse(JSON.stringify(first))).toStrictEqual({
    rootModule: "ConformanceInspectionModule",
    modules: [
      {
        id: "ConformanceInspectionServicesModule",
        imports: [],
        controllers: [],
        providers: [{ token: "ConformanceInspectionService", kind: "class", dependencies: [] }],
        exports: ["ConformanceInspectionService"],
      },
      {
        id: "ConformanceInspectionModule",
        imports: ["ConformanceInspectionServicesModule"],
        controllers: ["ConformanceInspectionController"],
        providers: [],
        exports: [],
      },
    ],
    routes: [
      {
        method: "POST",
        path: "/conformance-inspection",
        module: "ConformanceInspectionModule",
        controller: "ConformanceInspectionController",
        handler: "create",
        parameters: [{ index: 0, kind: "body", property: "name" }],
      },
      {
        method: "GET",
        path: "/conformance-inspection/:id",
        module: "ConformanceInspectionModule",
        controller: "ConformanceInspectionController",
        handler: "find",
        parameters: [{ index: 0, kind: "params", property: "id" }],
      },
    ],
    gateways: [],
  });
});

test("the Vite+ lane returns empty collections for an application without controllers", () => {
  const inspection = inspectAponiaApplication(conformanceInspectionEmptyModule);

  expect(inspection).toEqual({
    rootModule: "ConformanceInspectionEmptyModule",
    modules: [
      {
        id: "ConformanceInspectionEmptyModule",
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

test("the Vite+ lane resolves a descriptor artifact when inspecting an application", () => {
  const inspectionAssertions: readonly boolean[] = [
    true satisfies InspectionOptionsAssertion,
    true satisfies InspectionDescriptorsAssertion,
    true satisfies InspectionLoggerAssertion,
  ];
  const declared = inspectAponiaApplication(
    ConformanceInspectionModule,
    documentedInspectionOptions,
  );
  // A refusal is not an error here either: the decorated module the application
  // named is inspected instead, which is the graph bootstrap would lower. The
  // logger is the `false` a generated application forwards to the factory.
  const refused = inspectAponiaApplication(ConformanceInspectionModule, {
    descriptors: Object.freeze({ framework: "0.0.0", elysia: null, modules: Object.freeze({}) }),
    logger: false,
  });

  expect(inspectionAssertions).toEqual([true, true, true]);
  expect(declared.rootModule).toBe("ConformanceInspectionDeclaredModule");
  expect(declared.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
    "GET /conformance-declared-inspection/ping",
  ]);
  expect(refused).toEqual(inspectAponiaApplication(ConformanceInspectionModule));
});

test("the Vite+ lane raises the typed errors bootstrap would raise", () => {
  class ConformanceUndecoratedModule {}

  expect(() => inspectAponiaApplication(ConformanceUndecoratedModule)).toThrow(
    expect.objectContaining({ code: "INVALID_MODULE" }),
  );
  expect(() => inspectAponiaApplication(ConformanceDuplicateGatewayModule)).toThrow(
    expect.objectContaining({ code: "DUPLICATE_WEBSOCKET_GATEWAY" }),
  );
});

function deepFreezeViolation(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  if (!Object.isFrozen(value)) {
    return "found an unfrozen inspection value";
  }

  for (const nested of Object.values(value)) {
    const violation = deepFreezeViolation(nested);
    if (violation) {
      return violation;
    }
  }

  return undefined;
}
