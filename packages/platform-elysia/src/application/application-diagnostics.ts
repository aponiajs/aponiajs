import { tokenName, type EnhancerMetadata, type ModuleDefinition } from "@aponiajs/common";
import type { Elysia } from "elysia";
import { isElysiaController } from "../controllers/controller-definition.ts";
import type {
  AponiaApplicationDiagnostics,
  AponiaCompiledRouteDiagnostics,
  AponiaInvokerDiagnostics,
} from "./application-diagnostics.types.ts";

/**
 * The key one boot's record is attached under.
 *
 * A registered symbol rather than a fresh one, because the package that reads
 * the record may hold its own copy of this module and both copies must name the
 * same key. Either way the property is invisible to `Object.keys`,
 * `Object.entries`, spreading, and Elysia's own composition, which is what keeps
 * a seam out of the application's shape.
 */
const diagnosticsKey: unique symbol = Symbol.for("aponia.application.diagnostics");

/**
 * Builds one boot's record from the decisions it made and the milestones it
 * reached.
 *
 * The plans are read from the compiled modules rather than from the native
 * application, which knows a route's method and path but neither the controller
 * nor the module that mounted it. Modules keep graph order and controllers keep
 * declaration order, so the record is deterministic.
 *
 * The invoker verdict is copied before it is frozen: it is the caller's object,
 * and a record may never be the place its own facts are still mutable.
 *
 * @internal
 */
export function createApplicationDiagnostics(facts: {
  readonly framework: string;
  readonly graph: "declared" | "decorated";
  readonly invokers: AponiaInvokerDiagnostics;
  readonly rootModule: ModuleDefinition;
  readonly modules: readonly ModuleDefinition[];
  readonly globalEnhancers: EnhancerMetadata;
}): AponiaApplicationDiagnostics {
  return Object.freeze({
    framework: facts.framework,
    graph: facts.graph,
    invokers: Object.freeze({ accepted: facts.invokers.accepted, reason: facts.invokers.reason }),
    rootModule: facts.rootModule,
    routes: collectCompiledRoutes(facts.modules),
    globalEnhancers: facts.globalEnhancers,
  });
}

/**
 * Attaches one boot's record to the native application it returned.
 *
 * The property is defined rather than assigned, and its three flags are the
 * whole contract: enumerable would make the record part of an instance's shape
 * for anything that walks keys, writable would let a later boot overwrite the
 * decision a reader already saw, and configurable would let either be undone.
 *
 * @internal
 */
export function attachApplicationDiagnostics(
  application: Elysia,
  diagnostics: AponiaApplicationDiagnostics,
): void {
  Object.defineProperty(application, diagnosticsKey, {
    value: Object.freeze(diagnostics),
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

/**
 * The record one boot attached, or `undefined` for an application no boot
 * produced.
 *
 * A plain `Elysia`, a plugin instance, and an application built without the
 * factory all read as `undefined` rather than as an empty record, so a reader
 * can tell "no boot happened here" from "this boot decided nothing".
 *
 * @internal
 */
export function readApplicationDiagnostics(
  application: Elysia,
): AponiaApplicationDiagnostics | undefined {
  return (application as { readonly [diagnosticsKey]?: AponiaApplicationDiagnostics })[
    diagnosticsKey
  ];
}

/**
 * Every compiled plan a module graph's controllers carry.
 *
 * A controller the graph holds but the platform does not own has no plan to
 * read, and one mounted through the low-level descriptor path builds its routes
 * in a callback that needs an instance, so neither contributes an entry: the
 * record states what was compiled, never a guess at what mounted.
 */
function collectCompiledRoutes(
  modules: readonly ModuleDefinition[],
): readonly AponiaCompiledRouteDiagnostics[] {
  const routes: AponiaCompiledRouteDiagnostics[] = [];

  for (const module of modules) {
    for (const controller of module.controllers) {
      if (!isElysiaController(controller)) {
        continue;
      }

      const controllerName = tokenName(controller.token);
      for (const route of controller.compiledRoutes ?? []) {
        routes.push(Object.freeze({ module: module.id, controller: controllerName, route }));
      }
    }
  }

  return Object.freeze(routes);
}
