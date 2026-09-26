import {
  tokenName,
  type EnhancerMetadata,
  type ModuleDefinition,
  type Token,
} from "@aponiajs/common";
import type { Elysia } from "elysia";
import { isElysiaController } from "../controllers/controller-definition.ts";
import type {
  AponiaApplicationDiagnostics,
  AponiaArtifactProvenance,
  AponiaCallbackRouteDiagnostics,
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
 * Two facts arrive as the boot's own working data rather than as something to
 * read back: which property keys a supplied invoker bound, collected by the
 * mounts that took that decision, and the routes a controller's registration
 * callback added, observed while the mounted table grew. Neither is recoverable
 * afterwards — a mounted route keeps no controller, and a supplied invoker is
 * indistinguishable from a compiled one once it is registered.
 *
 * Every fact it is handed is copied before it is frozen — the invoker verdict,
 * the artifact provenance, the root descriptor, the callback routes, and the
 * enhancer declaration are all the caller's objects — because a record may never
 * be the place its own facts are still mutable. Nothing here relies on the boot
 * having frozen them first: a reader of the record cannot see how the boot kept
 * them.
 *
 * @internal
 */
export function createApplicationDiagnostics(facts: {
  readonly framework: string;
  readonly graph: "declared" | "decorated";
  readonly invokers: AponiaInvokerDiagnostics;
  readonly artifacts: AponiaArtifactProvenance;
  readonly rootModule: ModuleDefinition;
  readonly modules: readonly ModuleDefinition[];
  readonly generatedInvokers: ReadonlyMap<Token<unknown>, ReadonlySet<string | symbol>>;
  readonly callbackRoutes: readonly AponiaCallbackRouteDiagnostics[];
  readonly globalEnhancers: EnhancerMetadata;
}): AponiaApplicationDiagnostics {
  return Object.freeze({
    framework: facts.framework,
    graph: facts.graph,
    invokers: Object.freeze({ accepted: facts.invokers.accepted, reason: facts.invokers.reason }),
    artifacts: Object.freeze({
      invokers: facts.artifacts.invokers,
      descriptors: facts.artifacts.descriptors,
    }),
    rootModule: freezeModuleDefinition(facts.rootModule),
    routes: collectCompiledRoutes(facts.modules, facts.generatedInvokers),
    callbackRoutes: freezeCallbackRoutes(facts.callbackRoutes),
    globalEnhancers: freezeEnhancerMetadata(facts.globalEnhancers),
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
 * The root descriptor as the record publishes it: one frozen object carrying
 * frozen copies of the four collections a reader walks.
 *
 * The compiler freezes what it lowers and `defineModule` freezes what it
 * normalizes, but a caller can hand a boot a hand-written descriptor, so the
 * record copies rather than trusting the object it was given.
 */
function freezeModuleDefinition(module: ModuleDefinition): ModuleDefinition {
  return Object.freeze({
    ...module,
    imports: Object.freeze([...module.imports]),
    controllers: Object.freeze([...module.controllers]),
    providers: Object.freeze([...module.providers]),
    exports: Object.freeze([...module.exports]),
  });
}

/**
 * The application's own enhancer declaration as the record publishes it, copied
 * for the same reason the descriptor is: the arrays were built from the options
 * the caller passed.
 */
function freezeEnhancerMetadata(metadata: EnhancerMetadata): EnhancerMetadata {
  return Object.freeze({
    guards: Object.freeze([...metadata.guards]),
    interceptors: Object.freeze([...metadata.interceptors]),
    filters: Object.freeze([...metadata.filters]),
  });
}

/**
 * The callback routes as the record publishes them, copied for the same reason
 * the descriptor is: the entries were built while the boot was mounting.
 */
function freezeCallbackRoutes(
  routes: readonly AponiaCallbackRouteDiagnostics[],
): readonly AponiaCallbackRouteDiagnostics[] {
  return Object.freeze(routes.map((route) => Object.freeze({ ...route })));
}

/**
 * Every compiled plan a module graph's controllers carry.
 *
 * A controller the graph holds but the platform does not own has no plan to
 * read, and one mounted through the low-level descriptor path builds its routes
 * in a callback that needs an instance, so neither contributes an entry: the
 * record states what was compiled, never a guess at what mounted.
 *
 * `generatedInvokers` is keyed by controller token rather than by handler
 * property key alone, because two controllers may declare the same property key
 * and only one of them be served by a supplied invoker. A token no mount took a
 * decision for — a controller that mounted through its callback, or a graph the
 * boot never expanded — contributes no entry, so every plan it holds is
 * `"compiled"`.
 */
function collectCompiledRoutes(
  modules: readonly ModuleDefinition[],
  generatedInvokers: ReadonlyMap<Token<unknown>, ReadonlySet<string | symbol>>,
): readonly AponiaCompiledRouteDiagnostics[] {
  const routes: AponiaCompiledRouteDiagnostics[] = [];

  for (const module of modules) {
    for (const controller of module.controllers) {
      if (!isElysiaController(controller)) {
        continue;
      }

      const controllerName = tokenName(controller.token);
      const generatedKeys = generatedInvokers.get(controller.token);
      for (const route of controller.compiledRoutes ?? []) {
        const source: "generated" | "compiled" =
          generatedKeys?.has(route.propertyKey) === true ? "generated" : "compiled";
        routes.push(
          Object.freeze({ module: module.id, controller: controllerName, route, source }),
        );
      }
    }
  }

  return Object.freeze(routes);
}
