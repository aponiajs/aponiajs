import {
  AponiaError,
  getTokenName,
  isForwardRef,
  isOptionalInjection,
  ModuleRef,
  provideValue,
  resolveForwardRef,
  type ControllerDefinition,
  type InjectionDependency,
  type ModuleDefinition,
  type Provider,
  type ProviderScope,
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

  // Cache of singleton provider instances scoped per ModuleDefinition
  readonly #instances = new Map<ModuleDefinition, Map<Provider, unknown>>();
  readonly #controllers = new Map<ModuleDefinition, Map<ControllerDefinition, unknown>>();
  readonly #resolving: ProviderLocation[] = [];
  readonly #requestInstances = new WeakMap<object, Map<ModuleDefinition, Map<Provider, unknown>>>();
  readonly #requestControllers = new WeakMap<
    object,
    Map<ModuleDefinition, Map<ControllerDefinition, unknown>>
  >();
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
   * The lifetime a provider is instantiated with.
   *
   * A declared scope wins, except that a provider declaring `"singleton"` (or
   * nothing) whose dependencies reach request-scoped state is instantiated per
   * request instead: the scope bubbles outward along the injection chain, so a
   * controller or service that depends on request state is built with the
   * request that asks for it rather than being refused.
   *
   * @param module - The module the provider is declared in.
   * @param provider - The provider to inspect.
   * @returns The lifetime the container uses.
   *
   * @internal
   */
  providerScope(module: ModuleDefinition, provider: Provider): ProviderScope {
    const declared = provider.scope ?? "singleton";
    if (declared !== "singleton") {
      return declared;
    }
    return this.graph.requiresRequestContext(module, provider) ? "request" : "singleton";
  }

  /**
   * The lifetime a controller is instantiated with.
   *
   * A controller is request-scoped when it declares `"request"` or depends on
   * anything that needs a request context.
   *
   * @param module - The module the controller is declared in.
   * @param controller - The controller to inspect.
   * @returns `"request"` or `"singleton"`.
   *
   * @internal
   */
  controllerScope(
    module: ModuleDefinition,
    controller: ControllerDefinition,
  ): Exclude<ProviderScope, "transient"> {
    if (controller.scope === "request") {
      return "request";
    }
    for (const dependency of controller.inject) {
      const optional = isOptionalInjection(dependency);
      const token = resolveForwardRef(optional ? dependency.token : dependency);
      if (token === ModuleRef) {
        continue;
      }
      let location: ProviderLocation;
      try {
        location = this.graph.locate(module, token);
      } catch (error) {
        if (optional && error instanceof AponiaError && error.code === "MISSING_PROVIDER") {
          continue;
        }
        throw error;
      }
      if (this.providerScope(location.module, location.provider) === "request") {
        return "request";
      }
    }
    return "singleton";
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
    if (token === ModuleRef) {
      return new ContainerModuleRef(this, this.graph.root) as T;
    }
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
    if (token === ModuleRef) {
      return new ContainerModuleRef(this, module) as T;
    }
    const location = this.graph.locate(module, token);
    return this.#resolve(location, context) as T;
  }

  /**
   * Instantiates a provider in an arbitrary module without caching it.
   *
   * The platform SPI behind `ModuleRef.create`. A request-scoped provider needs
   * an active context; every other lifetime produces a fresh instance even when
   * the container already holds one.
   *
   * @internal
   */
  createInModule<T>(module: ModuleDefinition, token: Token<T>, context?: object): T {
    if (token === ModuleRef) {
      return new ContainerModuleRef(this, module) as T;
    }

    const location = this.graph.locate(module, token);
    assertSupportedScope(location.provider);

    const scope = this.providerScope(location.module, location.provider);
    const activeContext = context ?? this.#contextAccessor?.();
    if (scope === "request" && !activeContext) {
      throw new AponiaError(
        "MISSING_REQUEST_CONTEXT",
        `Cannot create request-scoped provider "${getTokenName(location.provider.provide)}" outside of an active request context.`,
        {
          module: location.module.id,
          token: getTokenName(location.provider.provide),
        },
      );
    }

    this.#assertNoProviderCycle(location);
    this.#resolving.push(location);
    try {
      const dependencies = getProviderDependencies(location.provider).map((dependency) =>
        this.#resolveDependency(location.module, dependency, activeContext),
      );
      return instantiate(location.provider, dependencies) as T;
    } finally {
      this.#resolving.pop();
    }
  }

  /**
   * Eagerly instantiates every singleton provider a module declares.
   *
   * Providers whose lifetime is `"request"` or `"transient"` are deferred, and
   * so is a provider whose dependencies bubble its lifetime to `"request"`.
   *
   * @param module - The module whose providers to instantiate.
   */
  initializeModule(module: ModuleDefinition): void {
    for (const provider of module.providers) {
      assertSupportedScope(provider);
      if (this.providerScope(module, provider) !== "singleton") {
        continue;
      }
      this.#resolve({ module, provider });
    }
  }

  /**
   * Constructs a controller, reusing its cached instance.
   *
   * A request-scoped controller has one instance per request context: the
   * caller passes the context, or the ambient accessor supplies it, and a
   * construction outside any request fails with `MISSING_REQUEST_CONTEXT`.
   *
   * @param module - The module the controller is declared in.
   * @param controller - The controller descriptor to construct.
   * @param context - Optional request context object for a request-scoped controller.
   * @returns The controller instance for this lifetime.
   */
  instantiateController<T>(
    module: ModuleDefinition,
    controller: ControllerDefinition,
    context?: object,
  ): T {
    if (this.controllerScope(module, controller) === "request") {
      const activeContext = context ?? this.#contextAccessor?.();
      if (!activeContext) {
        throw new AponiaError(
          "MISSING_REQUEST_CONTEXT",
          `Cannot construct request-scoped controller "${getTokenName(controller.token)}" outside of an active request context.`,
          { module: module.id, token: getTokenName(controller.token) },
        );
      }

      let contextModules = this.#requestControllers.get(activeContext);
      const cachedInstance = contextModules?.get(module)?.get(controller);
      if (cachedInstance !== undefined) {
        return cachedInstance as T;
      }

      const dependencies = controller.inject.map((dependency) =>
        this.#resolveDependency(module, dependency, activeContext),
      );
      const instance = Reflect.construct(controller.useClass, dependencies) as T;
      if (!contextModules) {
        contextModules = new Map();
        this.#requestControllers.set(activeContext, contextModules);
      }
      this.#moduleCache(contextModules, module).set(controller, instance);
      return instance;
    }

    const moduleControllers = this.#controllers.get(module);
    if (moduleControllers?.has(controller)) {
      return moduleControllers.get(controller) as T;
    }

    const dependencies = controller.inject.map((dependency) =>
      this.#resolveDependency(module, dependency),
    );
    const instance = Reflect.construct(controller.useClass, dependencies) as T;
    this.#moduleCache(this.#controllers, module).set(controller, instance);
    return instance;
  }

  /** Refuses a resolution that re-enters a provider already being resolved. */
  #assertNoProviderCycle(location: ProviderLocation): void {
    const cycleIndex = this.#resolving.findIndex(
      (item) => item.module === location.module && item.provider === location.provider,
    );
    if (cycleIndex < 0) {
      return;
    }

    const cycle = [...this.#resolving.slice(cycleIndex), location].map(
      (item) => `${item.module.id}:${getTokenName(item.provider.provide)}`,
    );
    throw new AponiaError(
      "PROVIDER_CYCLE",
      `Provider dependency cycle detected: ${cycle.join(" -> ")}.`,
      { cycle },
    );
  }

  #resolve(location: ProviderLocation, context?: object): unknown {
    assertSupportedScope(location.provider);

    const scope = this.providerScope(location.module, location.provider);
    const activeContext = context ?? this.#contextAccessor?.();

    if (scope === "request") {
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
    } else if (scope !== "transient") {
      const moduleInstances = this.#instances.get(location.module);
      if (moduleInstances?.has(location.provider)) {
        return moduleInstances.get(location.provider);
      }
    }

    this.#assertNoProviderCycle(location);

    this.#resolving.push(location);
    try {
      const dependencies = getProviderDependencies(location.provider).map((dependency) =>
        this.#resolveDependency(location.module, dependency, activeContext),
      );
      const instance = instantiate(location.provider, dependencies);

      if (scope === "request") {
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
      } else if (scope !== "transient") {
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
      set(_target, prop, value) {
        const instance = resolveInstance();
        return Reflect.set(instance as object, prop, value);
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

  #resolveDependency(
    module: ModuleDefinition,
    dependency: InjectionDependency,
    context?: object,
  ): unknown {
    const optional = isOptionalInjection(dependency);
    const token = optional ? dependency.token : dependency;

    if (token === ModuleRef) {
      return new ContainerModuleRef(this, module);
    }

    const unwrapped = resolveForwardRef(token);
    try {
      const location = this.graph.locate(module, unwrapped);
      const inResolving = this.#resolving.some(
        (item) => item.module === location.module && item.provider === location.provider,
      );
      if (inResolving && isForwardRef(token)) {
        return this.#createForwardRefProxy(location, context);
      }
      return this.#resolve(location, context);
    } catch (error) {
      if (optional && error instanceof AponiaError && error.code === "MISSING_PROVIDER") {
        return undefined;
      }
      throw error;
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
  return new AponiaContainer(
    compileModuleGraph(root, [
      provideValue(ModuleRef, undefined as unknown as ModuleRef),
      ...(predefined ?? []),
    ]),
  );
}

/** A `ModuleRef` bound to the module whose provider received it. */
class ContainerModuleRef extends ModuleRef {
  readonly #container: AponiaContainer;
  readonly #module: ModuleDefinition;

  constructor(container: AponiaContainer, module: ModuleDefinition) {
    super();
    this.#container = container;
    this.#module = module;
  }

  get<T>(token: Token<T>): T {
    return this.#container.resolveModuleProvider(this.#module, token);
  }

  resolve<T>(token: Token<T>, context?: object): T {
    return this.#container.resolveModuleProvider(this.#module, token, context);
  }

  create<T>(token: Token<T>, context?: object): T {
    return this.#container.createInModule(this.#module, token, context);
  }
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
