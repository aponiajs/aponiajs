import {
  AponiaError,
  getTokenName,
  type ControllerDefinition,
  type ModuleDefinition,
  type Provider,
  type Token,
} from "@aponiajs/common";
import { getProviderDependencies } from "../graph/dependencies.ts";
import { compileModuleGraph } from "../graph/graph-compiler.ts";
import type { ProviderLocation } from "../graph/graph.types.ts";
import type { ModuleGraph } from "../graph/module-graph.ts";

/**
 * The dependency injection container: one cached instance per provider per
 * module, resolved through the compiled module graph.
 *
 * Construct through {@link createContainer}, which compiles the graph first.
 * `get` enforces root-module visibility; platforms resolve inside an
 * arbitrary module through `resolveModuleProvider`.
 */
export class AponiaContainer {
  readonly graph: ModuleGraph;

  readonly #instances = new Map<ModuleDefinition, Map<Provider, unknown>>();
  readonly #controllers = new Map<ModuleDefinition, Map<ControllerDefinition, unknown>>();
  readonly #resolving: ProviderLocation[] = [];

  constructor(graph: ModuleGraph) {
    this.graph = graph;
  }

  /**
   * Resolves a token against the root module.
   *
   * A provider that is not exported to the root is invisible here and fails
   * with `MISSING_PROVIDER`; two importers that disagree fail with
   * `AMBIGUOUS_PROVIDER`.
   *
   * @param token - The token to resolve.
   * @returns The cached singleton instance.
   * @throws An `AponiaError` with `MISSING_PROVIDER`, `AMBIGUOUS_PROVIDER`,
   * `PROVIDER_CYCLE`, or `UNSUPPORTED_PROVIDER_SCOPE`.
   *
   * @example
   * ```ts
   * const greeting = container.get(GREETING);
   * ```
   */
  get<T>(token: Token<T>): T {
    const location = this.graph.locate(this.graph.root, token);
    return this.#resolve(location) as T;
  }

  /**
   * Framework platform SPI for resolving a provider in its owning module.
   * Application code should use get(), which enforces root-module visibility.
   *
   * @internal
   */
  resolveModuleProvider<T>(module: ModuleDefinition, token: Token<T>): T {
    const location = this.graph.locate(module, token);
    return this.#resolve(location) as T;
  }

  /**
   * Eagerly instantiates every singleton provider a module declares.
   *
   * A provider that declares a `"request"` or `"transient"` scope fails here
   * with `UNSUPPORTED_PROVIDER_SCOPE`: its instances do not exist at boot, so
   * there is nothing to create yet.
   *
   * @param module - The module whose providers to instantiate.
   * @throws An `AponiaError` with `UNSUPPORTED_PROVIDER_SCOPE` for a scoped
   * provider, or the resolution codes `get` throws.
   */
  initializeModule(module: ModuleDefinition): void {
    for (const provider of module.providers) {
      assertSupportedScope(provider);
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
    // `"request"` and `"transient"` are reserved lifetimes the container does
    // not instantiate yet. Refusing here — rather than serving a singleton
    // where a fresh instance was promised — is what keeps the declaration
    // honest until the scope lands. The check also runs in `initializeModule`
    // so a scoped provider fails the boot in the eager pass rather than only
    // when something first resolves it.
    assertSupportedScope(location.provider);

    const moduleInstances = this.#instances.get(location.module);
    if (moduleInstances?.has(location.provider)) {
      return moduleInstances.get(location.provider);
    }

    const cycleIndex = this.#resolving.findIndex(
      (item) => item.module === location.module && item.provider === location.provider,
    );
    if (cycleIndex >= 0) {
      const cycle = [...this.#resolving.slice(cycleIndex), location].map(
        (item) => `${item.module.id}:${getTokenName(item.provider.provide)}`,
      );
      throw new AponiaError(
        "PROVIDER_CYCLE",
        `Provider dependency cycle detected: ${cycle.join(" -> ")}.`,
        { cycle },
      );
    }

    this.#resolving.push(location);
    try {
      const dependencies = getProviderDependencies(location.provider).map((dependency) =>
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

/**
 * Compiles the module graph from a root definition and returns its container.
 *
 * Graph validation runs eagerly, before any instance exists: duplicate module
 * identity, import cycles, duplicate tokens, unresolvable dependencies.
 *
 * @param root - The root module definition the graph walks from.
 * @returns A container over the compiled graph.
 * @throws An `AponiaError` with the graph code naming the invalid declaration.
 *
 * @example
 * ```ts
 * const container = createContainer(AppModuleDefinition);
 * const greeting = container.get(GREETING);
 * ```
 */
export function createContainer(
  root: ModuleDefinition,
  predefined?: readonly Provider[],
): AponiaContainer {
  return new AponiaContainer(compileModuleGraph(root, predefined));
}

/**
 * Refuses a provider whose declared lifetime this release cannot honor.
 *
 * A single rule shared by the eager `initializeModule` pass and the lazy
 * `#resolve` path, so a scoped provider fails the boot whichever reaches it
 * first. `undefined` and `"singleton"` are the supported shape — every
 * provider written before scopes existed declares nothing — and anything else
 * is a promise the container must not silently downgrade to a singleton.
 */
function assertSupportedScope(provider: Provider): void {
  if (provider.scope === undefined || provider.scope === "singleton") {
    return;
  }

  throw new AponiaError(
    "UNSUPPORTED_PROVIDER_SCOPE",
    `Provider "${getTokenName(provider.provide)}" declares scope "${provider.scope}", which this release does not instantiate.`,
    {
      token: getTokenName(provider.provide),
      scope: provider.scope,
    },
  );
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
