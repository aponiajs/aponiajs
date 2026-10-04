import {
  AponiaError,
  Logger,
  LOGGER,
  NOOP_LOGGER,
  getTokenName,
  provideValue,
  type LoggerService,
  type LogLevel,
  type ModuleDefinition,
  type Provider,
} from "@aponiajs/common";
import { createContainer, getProviderDependencies } from "@aponiajs/core";
import { isElysiaController } from "../controllers/controller-definition.ts";
import type { RuntimeElysiaController } from "../controllers/controller.types.ts";
import { compileRootModule } from "../modules/module-compiler.ts";
import type { AponiaRootModule } from "../modules/module-compiler.types.ts";
import { selectRootModuleDescriptor } from "../modules/module-descriptor-artifact.ts";
import { aponiaVersion } from "../version.ts";
import { compileWebSocketGateways } from "../websockets/websocket-gateway.ts";
import type { CompiledWebSocketGateway } from "../websockets/websocket-gateway.types.ts";
import type {
  AponiaApplicationInspection,
  AponiaGatewayInspection,
  AponiaInspectionOptions,
  AponiaModuleInspection,
  AponiaProviderInspection,
  AponiaRouteInspection,
} from "./application-inspection.types.ts";

/**
 * Projects a root module into plain, frozen, JSON-serializable data describing
 * the application bootstrap would mount.
 *
 * Inspection runs the same lowering bootstrap runs — the same root resolution
 * from the descriptor artifact, then `compileRootModule`, then the container
 * that compiles the module graph, then gateway compilation — and reads the
 * resulting descriptors. It never resolves a provider and never constructs a
 * controller instance, so calling it has no side effects beyond compilation, and
 * it fails with the same `AponiaError` codes bootstrap would raise for the same
 * application.
 *
 * Resolving the root from the descriptor artifact is what keeps the projection
 * describing the graph the application actually serves: an application booting
 * from the artifact would otherwise be inspected as the decorated classes it
 * named. An artifact this release refuses is reported through the options'
 * logger, when one is configured, and the decorated module is inspected instead,
 * exactly as bootstrap lowers it.
 *
 * Routes come from the compiled route plans of decorated controllers. A
 * controller mounted through the low-level descriptor path produces its routes
 * in a callback that requires an instance, so it is listed in its module's
 * `controllers` but contributes no entries to `routes`.
 *
 * Repeated calls with the same root module and options return deeply equal data:
 * modules keep graph order, providers and gateway events keep declaration order,
 * and routes and gateways are sorted by their documented keys.
 *
 * @param rootModule - The root class, descriptor, or descriptor artifact to project.
 * @param options - The descriptor artifact and logger inspection reads through.
 * @returns The frozen, JSON-serializable projection of the compiled application.
 * @throws An `AponiaError` with the same code bootstrap raises for the same application.
 *
 * @example
 * ```ts
 * const inspection = inspectAponiaApplication(AppModule);
 * ```
 */
export function inspectAponiaApplication(
  rootModule: AponiaRootModule,
  options: AponiaInspectionOptions = {},
): AponiaApplicationInspection {
  const rootSelection = selectRootModuleDescriptor(
    options.descriptors,
    rootModule,
    aponiaVersion,
    resolveInspectionLogger(options.logger),
  );
  const container = createContainer(compileRootModule(rootSelection.rootModule), [
    provideValue(LOGGER, NOOP_LOGGER),
  ]);
  const modules = container.graph.modules;
  const gateways = compileWebSocketGateways(modules);

  return Object.freeze({
    rootModule: container.graph.root.id,
    modules: Object.freeze(modules.map(inspectModule)),
    routes: Object.freeze(modules.flatMap(inspectModuleRoutes).toSorted(compareRoutes)),
    gateways: Object.freeze(inspectGateways(gateways)),
  });
}

function inspectModule(module: ModuleDefinition): AponiaModuleInspection {
  return Object.freeze({
    id: module.id,
    instanceId: module.instanceId === undefined ? undefined : String(module.instanceId),
    imports: Object.freeze(module.imports.map((imported) => imported.id)),
    controllers: Object.freeze(
      controllers(module).map((controller) => getTokenName(controller.token)),
    ),
    providers: Object.freeze(module.providers.map(inspectProvider)),
    exports: Object.freeze(module.exports.map(getTokenName)),
  });
}

function inspectProvider(provider: Provider): AponiaProviderInspection {
  return Object.freeze({
    token: getTokenName(provider.provide),
    kind: provider.kind,
    dependencies: Object.freeze(
      getProviderDependencies(provider).map((dependency) => getTokenName(dependency)),
    ),
  });
}

function inspectModuleRoutes(module: ModuleDefinition): AponiaRouteInspection[] {
  return controllers(module).flatMap((controller) => {
    const controllerName = getTokenName(controller.token);
    const routes = controller.compiledRoutes ?? [];

    return routes.map((route) =>
      Object.freeze({
        method: route.method,
        path: route.path,
        module: module.id,
        controller: controllerName,
        handler: propertyKeyName(route.propertyKey),
        parameters: Object.freeze(
          route.parameters.map((parameter) =>
            Object.freeze({
              index: parameter.index,
              kind: parameter.kind,
              property: parameter.property,
            }),
          ),
        ),
      }),
    );
  });
}

function inspectGateways(gateways: readonly CompiledWebSocketGateway[]): AponiaGatewayInspection[] {
  return gateways
    .map((gateway) =>
      Object.freeze({
        module: gateway.module.id,
        token: getTokenName(gateway.token),
        path: gateway.path,
        events: Object.freeze(gateway.handlers.map((handler) => handler.event)),
      }),
    )
    .toSorted((left, right) => compareText(left.path, right.path));
}

/**
 * Narrows the option to the logger the root selector reports through.
 *
 * The shapes are the factory's, so an application can forward its own option
 * unchanged. An omitted option and `false` — what a generated application
 * passes — both stay silent, because an inspection prints only what its caller
 * asked for; unlike a boot, one that receives no logger writes nothing. A level
 * list is a caller asking for the platform's logger, so it builds one the way
 * the factory builds one.
 */
function resolveInspectionLogger(
  loggerOption: AponiaInspectionOptions["logger"],
): LoggerService | undefined {
  if (loggerOption === false || loggerOption === undefined) {
    return undefined;
  }

  if (isLogLevelList(loggerOption)) {
    return new Logger("AponiaInspection", { logLevels: loggerOption, timestamp: true });
  }

  return loggerOption;
}

// `Array.isArray` narrows to a mutable array, which a level list declared
// `readonly` is not, so the guard names the branch the option actually has.
function isLogLevelList(value: unknown): value is readonly LogLevel[] {
  return Array.isArray(value);
}

/**
 * Reuses the platform's own controller guard so inspection accepts exactly the
 * controllers bootstrap mounts and rejects the rest identically.
 */
function controllers(module: ModuleDefinition): readonly RuntimeElysiaController[] {
  return module.controllers.map((controller) => {
    if (isElysiaController(controller)) {
      return controller;
    }

    const controllerName = getTokenName(controller.token);
    throw new AponiaError(
      "UNSUPPORTED_CONTROLLER",
      `Controller "${controllerName}" is not supported by the Elysia platform.`,
      { module: module.id, controller: controllerName },
    );
  });
}

function compareRoutes(left: AponiaRouteInspection, right: AponiaRouteInspection): number {
  return (
    compareText(left.path, right.path) ||
    compareText(left.method, right.method) ||
    compareText(left.controller, right.controller) ||
    compareText(left.handler, right.handler) ||
    compareText(left.module, right.module)
  );
}

// Code-unit comparison keeps ordering identical in every JavaScript runtime,
// unlike locale-aware collation.
function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

// A symbol property key is projected with String(), which yields the readable
// "Symbol(description)" marker and never collides with an ordinary string key.
function propertyKeyName(propertyKey: string | symbol): string {
  return typeof propertyKey === "string" ? propertyKey : String(propertyKey);
}
