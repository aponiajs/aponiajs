import {
  AponiaError,
  tokenName,
  type ControllerDefinition,
  type ModuleDefinition,
  type Provider,
  type Token,
} from "@aponiajs/common";
import {
  compileModuleGraph,
  providerDependencies,
  type ModuleGraph,
  type ProviderLocation,
} from "./graph.ts";

export class AponiaContainer {
  readonly graph: ModuleGraph;

  readonly #instances = new Map<ModuleDefinition, Map<Provider, unknown>>();
  readonly #controllers = new Map<ModuleDefinition, Map<ControllerDefinition, unknown>>();
  readonly #resolving: ProviderLocation[] = [];

  constructor(graph: ModuleGraph) {
    this.graph = graph;
  }

  get<T>(token: Token<T>): T {
    const location = this.graph.locate(this.graph.root, token);
    return this.#resolve(location) as T;
  }

  initializeModule(module: ModuleDefinition): void {
    for (const provider of module.providers) {
      this.#resolve({ module, provider });
    }
  }

  instantiateController<T>(module: ModuleDefinition, controller: ControllerDefinition): T {
    const moduleControllers = this.#controllers.get(module);
    if (moduleControllers?.has(controller)) {
      return moduleControllers.get(controller) as T;
    }

    const dependencies = controller.inject.map((dependency) =>
      this.#resolve(this.graph.locate(module, dependency)),
    );
    const instance = Reflect.construct(controller.useClass, dependencies) as T;
    this.#moduleCache(this.#controllers, module).set(controller, instance);
    return instance;
  }

  #resolve(location: ProviderLocation): unknown {
    const moduleInstances = this.#instances.get(location.module);
    if (moduleInstances?.has(location.provider)) {
      return moduleInstances.get(location.provider);
    }

    const cycleIndex = this.#resolving.findIndex(
      (item) => item.module === location.module && item.provider === location.provider,
    );
    if (cycleIndex >= 0) {
      const cycle = [...this.#resolving.slice(cycleIndex), location].map(
        (item) => `${item.module.id}:${tokenName(item.provider.provide)}`,
      );
      throw new AponiaError(
        "PROVIDER_CYCLE",
        `Provider dependency cycle detected: ${cycle.join(" -> ")}.`,
        { cycle },
      );
    }

    this.#resolving.push(location);
    try {
      const dependencies = providerDependencies(location.provider).map((dependency) =>
        this.#resolve(this.graph.locate(location.module, dependency)),
      );
      const instance = instantiate(location.provider, dependencies);
      this.#moduleCache(this.#instances, location.module).set(location.provider, instance);
      return instance;
    } finally {
      this.#resolving.pop();
    }
  }

  #moduleCache<TKey extends object>(
    cache: Map<ModuleDefinition, Map<TKey, unknown>>,
    module: ModuleDefinition,
  ): Map<TKey, unknown> {
    let moduleCache = cache.get(module);
    if (!moduleCache) {
      moduleCache = new Map();
      cache.set(module, moduleCache);
    }
    return moduleCache;
  }
}

export function createContainer(root: ModuleDefinition): AponiaContainer {
  return new AponiaContainer(compileModuleGraph(root));
}

function instantiate(provider: Provider, dependencies: readonly unknown[]): unknown {
  switch (provider.kind) {
    case "value":
      return provider.useValue;
    case "alias":
      return dependencies[0];
    case "factory":
      return Reflect.apply(provider.useFactory, undefined, dependencies);
    case "class":
      return Reflect.construct(provider.useClass, dependencies);
  }
}
