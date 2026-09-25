import { AponiaError, tokenName, type ModuleDefinition, type Provider } from "@aponiajs/common";
import { createContainer, providerDependencies } from "@aponiajs/core";
import { isElysiaController } from "../controllers/controller-definition.ts";
import type { RuntimeElysiaController } from "../controllers/controller.types.ts";
import { compileRootModule } from "../modules/module-compiler.ts";
import type { AponiaRootModule } from "../modules/module-compiler.types.ts";
import { compileElysiaWebSocketGateways } from "../websockets/websocket-gateway.ts";
import type { CompiledElysiaWebSocketGateway } from "../websockets/websocket-gateway.types.ts";
import type {
  AponiaApplicationInspection,
  AponiaGatewayInspection,
  AponiaModuleInspection,
  AponiaProviderInspection,
  AponiaRouteInspection,
} from "./application-inspection.types.ts";

/**
 * Projects a root module into plain, frozen, JSON-serializable data describing
 * the application bootstrap would mount.
 *
 * Inspection runs the same lowering bootstrap runs — `compileRootModule`, then
 * the container that compiles the module graph, then gateway compilation — and
 * reads the resulting descriptors. It never resolves a provider and never
 * constructs a controller instance, so calling it has no side effects beyond
 * compilation, and it fails with the same `AponiaError` codes bootstrap would
 * raise for the same application.
 *
 * Routes come from the compiled route plans of decorated controllers. A
 * controller mounted through the low-level descriptor path produces its routes
 * in a callback that requires an instance, so it is listed in its module's
 * `controllers` but contributes no entries to `routes`.
 *
 * Repeated calls with the same root module return deeply equal data: modules
 * keep graph order, providers and gateway events keep declaration order, and
 * routes and gateways are sorted by their documented keys.
 */
export function inspectAponiaApplication(
  rootModule: AponiaRootModule,
): AponiaApplicationInspection {
  const container = createContainer(compileRootModule(rootModule));
  const modules = container.graph.modules;
  const gateways = compileElysiaWebSocketGateways(modules);

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
      elysiaControllers(module).map((controller) => tokenName(controller.token)),
    ),
    providers: Object.freeze(module.providers.map(inspectProvider)),
    exports: Object.freeze(module.exports.map(tokenName)),
  });
}

function inspectProvider(provider: Provider): AponiaProviderInspection {
  return Object.freeze({
    token: tokenName(provider.provide),
    kind: provider.kind,
    dependencies: Object.freeze(
      providerDependencies(provider).map((dependency) => tokenName(dependency)),
    ),
  });
}

function inspectModuleRoutes(module: ModuleDefinition): AponiaRouteInspection[] {
  return elysiaControllers(module).flatMap((controller) => {
    const controllerName = tokenName(controller.token);
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

function inspectGateways(
  gateways: readonly CompiledElysiaWebSocketGateway[],
): AponiaGatewayInspection[] {
  return gateways
    .map((gateway) =>
      Object.freeze({
        module: gateway.module.id,
        token: tokenName(gateway.token),
        path: gateway.path,
        events: Object.freeze(gateway.handlers.map((handler) => handler.event)),
      }),
    )
    .toSorted((left, right) => compareText(left.path, right.path));
}

/**
 * Reuses the platform's own controller guard so inspection accepts exactly the
 * controllers bootstrap mounts and rejects the rest identically.
 */
function elysiaControllers(module: ModuleDefinition): readonly RuntimeElysiaController[] {
  return module.controllers.map((controller) => {
    if (isElysiaController(controller)) {
      return controller;
    }

    const controllerName = tokenName(controller.token);
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
