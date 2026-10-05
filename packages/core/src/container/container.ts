import {
  AponiaError,
  getTokenName,
  isForwardRef,
  resolveForwardRef,
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
 * A callback function returning the active request context object, or undefined outside a request.
 */
export type RequestContextAccessor = () => object | undefined;

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
  readonly #requestInstances = new WeakMap<object, Map<ModuleDefinition, Map<Provider, unknown>>>();
  #contextAccessor?: RequestContextAccessor;

  constructor(graph: ModuleGraph) {
    this.graph = graph;
  }

  /**
   * Sets the ambient request context accessor used to resolve request-scoped providers.
   *
   * @param accessor - Function returning the active request context object, or undefined.
   */
  setRequestContextAccessor(accessor: RequestContextAccessor | undefined): void {
    this.#contextAccessor = accessor;
  }

  /**
   * Resolves a token against the root module.
   *
   * A provider that is not exported to the root is invisible here and fails
   * with `MISSING_PROVIDER`; two importers that disagree fail with
   * `AMBIGUOUS_PROVIDER`.
   *
   * @param token - The token to resolve.
   * @param context - Optional request context object for request-scoped resolution.
   * @returns The resolved instance.
   * @throws An `AponiaError` with `MISSING_PROVIDER`, `AMBIGUOUS_PROVIDER`,
   * `PROVIDER_CYCLE`, `UNSUPPORTED_PROVIDER_SCOPE`, or `MISSING_REQUEST_CONTEXT`.
   *
   * @example
   * ```ts
   * const greeting = container.get(GREETING);
   * ```
   */
  get<T>(token: Token<T>, context?: object): T {
    const location = this.graph.locate(this.graph.root, token);
    return this.#resolve(location, context) as T;
  }

  /**
   * Framework platform SPI for resolving a provider in its owning module.
   * Application code should use get(), which enforces root-module visibility.
   *
   * @internal
   */
  resolveModuleProvider<T>(module: ModuleDefinition, token: Token<T>, context?: object): T {
    const location = this.graph.locate(module, token);
    return this.#resolve(location, context) as T;
  }

  /**
   * Eagerly instantiates every singleton provider a module declares.
   *
   * Providers declaring `"request"` or `"transient"` scope are deferred.
   *
   * @param module - The module whose providers to instantiate.
   */
  initializeModule(module: ModuleDefinition): void {
    for (const provider of module.providers) {
      assertSupportedScope(provider);
      if (provider.scope === "request" || provider.scope === "transient") {
        continue;
      }
      this.#resolve({ module, provider });
    }
  }

  instantiateController<T>(module: ModuleDefinition, controller: ControllerDefinition): T {
    const moduleControllers = this.#controllers.get(module);
    if (moduleControllers?.has(controller)) {
      return moduleControllers.get(controller) as T;
    }

    const dependencies = controller.inject.map((dependency) => {
      const unwrapped = resolveForwardRef(dependency);
      return this.#resolve(this.graph.locate(module, unwrapped));
    });
    const instance = Reflect.construct(controller.useClass, dependencies) as T;
    this.#moduleCache(this.#controllers, module).set(controller, instance);
    return instance;
  }

  #resolve(location: ProviderLocation, context?: object): unknown {
    assertSupportedScope(location.provider);

    const activeContext = context ?? this.#contextAccessor?.();

    if (location.provider.scope === "request") {
      if (!activeContext) {
        throw new AponiaError(
          "MISSING_REQUEST_CONTEXT",
          `Cannot resolve request-scoped provider "${getTokenName(location.provider.provide)}" outside of an active request context.`,
          {
            module: location.module.id,
            token: getTokenName(location.provider.provide),
          },
        );
      }

      const contextModules = this.#requestInstances.get(activeContext);
      if (contextModules) {
        const moduleInstances = contextModules.get(location.module);
        if (moduleInstances?.has(location.provider)) {
          return moduleInstances.get(location.provider);
        }
      }
    } else if (location.provider.scope !== "transient") {
      const moduleInstances = this.#instances.get(location.module);
      if (moduleInstances?.has(location.provider)) {
        return moduleInstances.get(location.provider);
      }
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
      const dependencies = getProviderDependencies(location.provider).map((dependency) => {
        const unwrapped = resolveForwardRef(dependency);
        const depLocation = this.graph.locate(location.module, unwrapped);
        const inResolving = this.#resolving.some(
          (item) => item.module === depLocation.module && item.provider === depLocation.provider,
        );
        if (inResolving && isForwardRef(dependency)) {
          return this.#createForwardRefProxy(depLocation, activeContext);
        }
        return this.#resolve(depLocation, activeContext);
      });
      const instance = instantiate(location.provider, dependencies);

      if (location.provider.scope === "request") {
        let contextModules = this.#requestInstances.get(activeContext!);
        if (!contextModules) {
          contextModules = new Map();
          this.#requestInstances.set(activeContext!, contextModules);
        }
        let moduleInstances = contextModules.get(location.module);
        if (!moduleInstances) {
          moduleInstances = new Map();
          contextModules.set(location.module, moduleInstances);
        }
        moduleInstances.set(location.provider, instance);
      } else if (location.provider.scope !== "transient") {
        this.#moduleCache(this.#instances, location.module).set(location.provider, instance);
      }

      return instance;
    } finally {
      this.#resolving.pop();
    }
  }

  #createForwardRefProxy(location: ProviderLocation, context?: object): unknown {
    const resolveInstance = (): unknown =>
      this.resolveModuleProvider(location.module, location.provider.provide, context);
    const target = {};
    return new Proxy(target, {
      get(_target, prop, receiver) {
        const instance = resolveInstance();
        const value = Reflect.get(instance as object, prop, receiver);
        if (typeof value === "function") {
          return value.bind(instance);
        }
        return value;
      },
      has(_target, prop) {
        const instance = resolveInstance();
        return Reflect.has(instance as object, prop);
      },
      set(_target, prop, value, receiver) {
        const instance = resolveInstance();
        return Reflect.set(instance as object, prop, value, receiver);
      },
      apply(_target, thisArg, argArray) {
        const instance = resolveInstance();
        return Reflect.apply(instance as Function, thisArg, argArray);
      },
      getPrototypeOf() {
        const instance = resolveInstance();
        return Reflect.getPrototypeOf(instance as object);
      },
    });
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
  const scope: string | undefined = provider.scope as string | undefined;
  if (
    scope === undefined ||
    scope === "singleton" ||
    scope === "request" ||
    scope === "transient"
  ) {
    return;
  }

  throw new AponiaError(
    "UNSUPPORTED_PROVIDER_SCOPE",
    `Provider "${getTokenName(provider.provide)}" declares scope "${scope}", which this release does not instantiate.`,
    {
      token: getTokenName(provider.provide),
      scope,
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
