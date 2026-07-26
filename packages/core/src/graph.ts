import {
  AponiaError,
  tokenName,
  type ControllerDefinition,
  type ModuleDefinition,
  type Provider,
  type Token,
} from "@aponiajs/common";

export interface ModuleInspection {
  readonly id: string;
  readonly imports: readonly string[];
  readonly controllers: readonly string[];
  readonly providers: readonly string[];
  readonly exports: readonly string[];
}

export interface GraphInspection {
  readonly root: string;
  readonly modules: readonly ModuleInspection[];
}

export interface ProviderLocation {
  readonly module: ModuleDefinition;
  readonly provider: Provider;
}

export class ModuleGraph {
  readonly root: ModuleDefinition;
  readonly modules: readonly ModuleDefinition[];

  readonly #moduleSet: ReadonlySet<ModuleDefinition>;
  readonly #providersByModule: ReadonlyMap<ModuleDefinition, ReadonlyMap<Token<unknown>, Provider>>;
  readonly #exportsByModule: ReadonlyMap<ModuleDefinition, ReadonlySet<Token<unknown>>>;
  readonly #locationsByModule = new Map<ModuleDefinition, Map<Token<unknown>, ProviderLocation>>();

  constructor(root: ModuleDefinition, modules: readonly ModuleDefinition[]) {
    this.root = root;
    this.modules = Object.freeze([...modules]);
    this.#moduleSet = new Set(modules);
    this.#providersByModule = new Map(
      modules.map((module) => [
        module,
        new Map(module.providers.map((provider) => [provider.provide, provider])),
      ]),
    );
    this.#exportsByModule = new Map(modules.map((module) => [module, new Set(module.exports)]));
  }

  inspect(): GraphInspection {
    return Object.freeze({
      root: this.root.id,
      modules: Object.freeze(
        this.modules.map((module) =>
          Object.freeze({
            id: module.id,
            imports: Object.freeze(module.imports.map((item) => item.id)),
            controllers: Object.freeze(
              module.controllers.map((controller) => tokenName(controller.token)),
            ),
            providers: Object.freeze(
              module.providers.map((provider) => tokenName(provider.provide)),
            ),
            exports: Object.freeze(module.exports.map(tokenName)),
          }),
        ),
      ),
    });
  }

  locate(module: ModuleDefinition, token: Token<unknown>): ProviderLocation {
    if (!this.#moduleSet.has(module)) {
      throw new AponiaError(
        "MISSING_PROVIDER",
        `Module "${module.id}" is not part of the compiled graph.`,
        { module: module.id, token: tokenName(token) },
      );
    }

    const cached = this.#locationsByModule.get(module)?.get(token);
    if (cached) {
      return cached;
    }

    const location = this.#locate(module, token, new Set());
    this.#cacheLocation(module, token, location);
    return location;
  }

  #locate(
    module: ModuleDefinition,
    token: Token<unknown>,
    visited: Set<ModuleDefinition>,
  ): ProviderLocation {
    const cached = this.#locationsByModule.get(module)?.get(token);
    if (cached) {
      return cached;
    }

    const own = this.#providersByModule.get(module)?.get(token);
    if (own) {
      const location = Object.freeze({ module, provider: own });
      this.#cacheLocation(module, token, location);
      return location;
    }

    if (visited.has(module)) {
      throw missingProvider(module, token);
    }
    visited.add(module);

    try {
      const candidates = new Map<ModuleDefinition, ProviderLocation>();
      for (const imported of module.imports) {
        if (!this.#exportsByModule.get(imported)?.has(token)) {
          continue;
        }

        const location = this.#locate(imported, token, visited);
        candidates.set(location.module, location);
      }

      if (candidates.size === 0) {
        throw missingProvider(module, token);
      }

      if (candidates.size > 1) {
        throw new AponiaError(
          "AMBIGUOUS_PROVIDER",
          `Token "${tokenName(token)}" is exported by multiple imports of module "${module.id}".`,
          {
            module: module.id,
            token: tokenName(token),
            candidates: [...candidates.values()].map((item) => item.module.id),
          },
        );
      }

      const location = candidates.values().next().value;
      if (!location) {
        throw missingProvider(module, token);
      }

      this.#cacheLocation(module, token, location);
      return location;
    } finally {
      visited.delete(module);
    }
  }

  #cacheLocation(
    module: ModuleDefinition,
    token: Token<unknown>,
    location: ProviderLocation,
  ): void {
    let moduleLocations = this.#locationsByModule.get(module);
    if (!moduleLocations) {
      moduleLocations = new Map();
      this.#locationsByModule.set(module, moduleLocations);
    }
    moduleLocations.set(token, location);
  }
}

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

export function controllerDependencies(
  controller: ControllerDefinition,
): readonly Token<unknown>[] {
  return controller.inject;
}

export function providerDependencies(provider: Provider): readonly Token<unknown>[] {
  switch (provider.kind) {
    case "value":
      return [];
    case "alias":
      return [provider.useExisting];
    case "class":
    case "factory":
      return provider.inject;
  }
}

function missingProvider(module: ModuleDefinition, token: Token<unknown>): AponiaError {
  return new AponiaError(
    "MISSING_PROVIDER",
    `Module "${module.id}" cannot resolve token "${tokenName(token)}".`,
    { module: module.id, token: tokenName(token) },
  );
}
