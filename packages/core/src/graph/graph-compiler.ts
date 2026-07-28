import { AponiaError, tokenName, type ModuleDefinition, type Token } from "@aponiajs/common";
import { providerDependencies } from "./dependencies.ts";
import { ModuleGraph } from "./module-graph.ts";

export function compileModuleGraph(root: ModuleDefinition): ModuleGraph {
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
    for (const imported of module.imports) {
      visit(imported);
    }
    visiting.pop();

    validateOwnProviders(module);
    visited.add(module);
    modules.push(module);
  };

  visit(root);
  const graph = new ModuleGraph(root, modules);
  validateExports(graph);
  validateDependencies(graph);
  validateControllers(graph);
  return graph;
}

function validateOwnProviders(module: ModuleDefinition): void {
  const tokens = new Set<Token<unknown>>();
  for (const provider of module.providers) {
    if (tokens.has(provider.provide)) {
      throw new AponiaError(
        "DUPLICATE_PROVIDER",
        `Module "${module.id}" declares token "${tokenName(provider.provide)}" more than once.`,
        { module: module.id, token: tokenName(provider.provide) },
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
            `Module "${module.id}" cannot export missing token "${tokenName(token)}".`,
            { module: module.id, token: tokenName(token) },
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
      for (const dependency of providerDependencies(provider)) {
        graph.locate(module, dependency);
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
          `Module "${module.id}" declares controller "${tokenName(controller.token)}" more than once.`,
          { module: module.id, token: tokenName(controller.token) },
        );
      }
      controllerTokens.add(controller.token);

      for (const dependency of controller.inject) {
        graph.locate(module, dependency);
      }
    }
  }
}
