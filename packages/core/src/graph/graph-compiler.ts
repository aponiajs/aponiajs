import {
  AponiaError,
  getTokenName,
  isForwardRef,
  resolveForwardRef,
  type ModuleDefinition,
  type Provider,
  type Token,
} from "@aponiajs/common";
import { getProviderDependencies, providerShapeProblem } from "./dependencies.ts";
import { ModuleGraph } from "./module-graph.ts";

/**
 * Compiles the module graph from a root definition, validating eagerly before
 * any instance exists.
 *
 * Identity is `instanceId ?? id`; cycles, duplicate tokens, unexported
 * exports, and unresolvable dependencies all fail here with their codes.
 *
 * @param root - The root module definition the walk starts from.
 * @returns The compiled graph in post-order.
 * @throws An `AponiaError` with `DUPLICATE_MODULE`, `MODULE_CYCLE`,
 * `INVALID_PROVIDER`, `DUPLICATE_PROVIDER`, `INVALID_EXPORT`,
 * `MISSING_PROVIDER`, or `AMBIGUOUS_PROVIDER`.
 *
 * @example
 * ```ts
 * const graph = compileModuleGraph(AppModuleDefinition);
 * ```
 */
export function compileModuleGraph(
  root: ModuleDefinition,
  predefined?: readonly Provider[],
): ModuleGraph {
  const modules: ModuleDefinition[] = [];
  const modulesByIdentity = new Map<string | symbol, ModuleDefinition>();
  const visiting: ModuleDefinition[] = [];
  const visited = new Set<ModuleDefinition>();

  const visit = (module: ModuleDefinition): void => {
    const identity = module.instanceId ?? module.id;
    const registered = modulesByIdentity.get(identity);
    if (registered && registered !== module) {
      throw new AponiaError(
        "DUPLICATE_MODULE",
        `Module id "${module.id}" belongs to more than one definition.`,
        { module: module.id },
      );
    }
    modulesByIdentity.set(identity, module);

    const cycleIndex = visiting.indexOf(module);
    if (cycleIndex >= 0) {
      const cycle = [...visiting.slice(cycleIndex), module].map((item) => item.id);
      throw new AponiaError(
        "MODULE_CYCLE",
        `Module import cycle detected: ${cycle.join(" -> ")}.`,
        { cycle },
      );
    }

    if (visited.has(module)) {
      return;
    }

    visiting.push(module);
    for (const rawImport of module.imports) {
      const isForward = isForwardRef(rawImport);
      const imported = resolveForwardRef(rawImport);
      if (isForward && visiting.includes(imported)) {
        continue;
      }
      visit(imported);
    }
    visiting.pop();

    validateOwnProviders(module);
    visited.add(module);
    modules.push(module);
  };

  visit(root);
  const graph = new ModuleGraph(root, modules, predefined);
  validateExports(graph);
  validateDependencies(graph);
  validateControllers(graph);
  return graph;
}

function validateOwnProviders(module: ModuleDefinition): void {
  const tokens = new Set<Token<unknown>>();

  for (const [index, provider] of module.providers.entries()) {
    // The shape of the entry is checked before any field of it is read. Everything
    // below reads `provide`, and an entry that is not a provider has no field to
    // read: this runs during the graph walk, so the failure would name this
    // compiler rather than the entry that is wrong.
    const problem = providerShapeProblem(provider);

    if (problem !== undefined) {
      throw new AponiaError(
        "INVALID_PROVIDER",
        `Module "${module.id}" declares providers[${index}], which is not a provider this release can use: ${problem}.`,
        { module: module.id, index, problem },
      );
    }

    if (tokens.has(provider.provide)) {
      throw new AponiaError(
        "DUPLICATE_PROVIDER",
        `Module "${module.id}" declares token "${getTokenName(provider.provide)}" more than once.`,
        { module: module.id, token: getTokenName(provider.provide) },
      );
    }
    tokens.add(provider.provide);
  }
}

function validateExports(graph: ModuleGraph): void {
  for (const module of graph.modules) {
    for (const token of module.exports) {
      try {
        graph.locate(module, token);
      } catch (error) {
        if (error instanceof AponiaError && error.code === "MISSING_PROVIDER") {
          throw new AponiaError(
            "INVALID_EXPORT",
            `Module "${module.id}" cannot export missing token "${getTokenName(token)}".`,
            { module: module.id, token: getTokenName(token) },
          );
        }
        throw error;
      }
    }
  }
}

function validateDependencies(graph: ModuleGraph): void {
  for (const module of graph.modules) {
    for (const provider of module.providers) {
      const providerScope = provider.scope ?? "singleton";
      for (const dependency of getProviderDependencies(provider)) {
        const location = graph.locate(module, resolveForwardRef(dependency));
        const dependencyScope = location.provider.scope ?? "singleton";

        if (providerScope === "singleton" && dependencyScope === "request") {
          throw new AponiaError(
            "INVALID_SCOPE_HIERARCHY",
            `Singleton provider "${getTokenName(provider.provide)}" in module "${module.id}" cannot depend on request-scoped provider "${getTokenName(location.provider.provide)}" in module "${location.module.id}".`,
            {
              module: module.id,
              provider: getTokenName(provider.provide),
              providerScope,
              dependency: getTokenName(location.provider.provide),
              dependencyScope,
            },
          );
        }
      }
    }
  }
}

function validateControllers(graph: ModuleGraph): void {
  for (const module of graph.modules) {
    const controllerTokens = new Set<Token<unknown>>();
    for (const controller of module.controllers) {
      if (controllerTokens.has(controller.token)) {
        throw new AponiaError(
          "DUPLICATE_PROVIDER",
          `Module "${module.id}" declares controller "${getTokenName(controller.token)}" more than once.`,
          { module: module.id, token: getTokenName(controller.token) },
        );
      }
      controllerTokens.add(controller.token);

      for (const dependency of controller.inject) {
        const location = graph.locate(module, resolveForwardRef(dependency));
        const dependencyScope = location.provider.scope ?? "singleton";
        if (dependencyScope === "request") {
          throw new AponiaError(
            "INVALID_SCOPE_HIERARCHY",
            `Singleton controller "${getTokenName(controller.token)}" in module "${module.id}" cannot depend on request-scoped provider "${getTokenName(location.provider.provide)}" in module "${location.module.id}".`,
            {
              module: module.id,
              controller: getTokenName(controller.token),
              dependency: getTokenName(location.provider.provide),
              dependencyScope,
            },
          );
        }
      }
    }
  }
}
