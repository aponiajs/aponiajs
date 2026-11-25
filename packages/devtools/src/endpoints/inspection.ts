import {
  getTokenName,
  isForwardRef,
  resolveForwardRef,
  type ModuleDefinition,
} from "@aponiajs/common";
import { getProviderDependencies } from "@aponiajs/core";
import { compileGatewayPlan, type AponiaBootDiagnostics } from "@aponiajs/platform-core";
import type {
  DevtoolsGatewayInspection,
  DevtoolsInspection,
  DevtoolsModuleInspection,
  DevtoolsRouteInspection,
} from "../interfaces/inspection.interface.ts";

/**
 * Projects the neutral boot record into plain, JSON-serializable data.
 *
 * Nothing is recompiled and no instance is constructed: every fact is one the
 * boot already published. The projection is the neutral counterpart of the
 * platform's own inspection, so the graph surface describes every platform the
 * same way.
 *
 * @internal
 */
export function inspectBootDiagnostics(
  diagnostics: AponiaBootDiagnostics | undefined,
): DevtoolsInspection | undefined {
  if (diagnostics?.rootModule === undefined) {
    return undefined;
  }

  return Object.freeze({
    rootModule: diagnostics.rootModule.id,
    modules: Object.freeze(
      diagnostics.modules.map((module) => inspectModule(module, diagnostics.routes)),
    ),
    routes: Object.freeze(
      diagnostics.routes.map((entry): DevtoolsRouteInspection =>
        Object.freeze({
          method: entry.route.method,
          path: entry.route.path,
          module: entry.module,
          controller: entry.controller,
          handler: String(entry.route.propertyKey),
          parameters: Object.freeze(
            entry.route.parameters.map((parameter) =>
              Object.freeze({
                index: parameter.index,
                kind: parameter.kind,
                property: parameter.property,
              }),
            ),
          ),
        }),
      ),
    ),
    gateways: Object.freeze(gatewaysOf(diagnostics.modules)),
    invokers: Object.freeze({
      accepted: diagnostics.invokers?.accepted ?? false,
      reason: diagnostics.invokers?.reason,
    }),
    artifacts: Object.freeze({
      invokers: diagnostics.artifacts?.invokers ?? null,
      descriptors: diagnostics.artifacts?.descriptors ?? null,
    }),
  });
}

function inspectModule(
  module: ModuleDefinition,
  routes: AponiaBootDiagnostics["routes"],
): DevtoolsModuleInspection {
  const controllerNames = new Set(
    routes.filter((entry) => entry.module === module.id).map((entry) => entry.controller),
  );

  return Object.freeze({
    id: module.id,
    instanceId: module.instanceId === undefined ? undefined : String(module.instanceId),
    imports: Object.freeze(
      module.imports.map((imported) =>
        isForwardRef(imported) ? resolveForwardRef(imported).id : imported.id,
      ),
    ),
    controllers: Object.freeze([...controllerNames].sort()),
    providers: Object.freeze(
      module.providers.map((provider) =>
        Object.freeze({
          token: getTokenName(provider.provide),
          kind: provider.kind,
          dependencies: Object.freeze(getProviderDependencies(provider).map(getTokenName)),
        }),
      ),
    ),
    exports: Object.freeze((module.exports ?? []).map(getTokenName)),
  });
}

function gatewaysOf(modules: readonly ModuleDefinition[]): readonly DevtoolsGatewayInspection[] {
  const gateways: DevtoolsGatewayInspection[] = [];
  for (const module of modules) {
    for (const provider of module.providers) {
      if (provider.kind !== "class") {
        continue;
      }
      const plan = compileGatewayPlan(provider.useClass);
      if (plan === undefined) {
        continue;
      }
      gateways.push(
        Object.freeze({
          module: module.id,
          token: provider.useClass.name,
          path: plan.path,
          events: Object.freeze(plan.handlers.map((handler) => handler.event)),
        }),
      );
    }
  }
  return Object.freeze(gateways);
}
