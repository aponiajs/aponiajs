import {
  AponiaError,
  getTokenName,
  isApplicationEnhancerToken,
  isForwardRef,
  isOptionalInjection,
  ModuleRef,
  normalizeProviderScope,
  provideValue,
  resolveForwardRef,
  Scope,
  type ControllerDefinition,
  type InjectionDependency,
  type ModuleDefinition,
  type ModuleRefGetOptions,
  type NormalizedProviderScope,
  type Provider,
  type Token,
} from "@aponiajs/common";
import { getProviderDependencies } from "../scanner/dependencies.ts";
import { compileModuleGraph } from "../scanner/graph-compiler.ts";
import type { ProviderLocation } from "../interfaces/graph.interface.ts";
import type { ModuleGraph } from "../scanner/module-graph.ts";
import {
  CONTEXT,
  ContextIdFactory,
  INQUIRER,
  REQUEST,
  REQUEST_CONTEXT_ID,
  type ContextId,
  type HostComponentInfo,
} from "../hooks/request-context.ts";

/**
 * A callback function returning the active request context object, or undefined outside a request.
 */
export type RequestContextAccessor = () => object | undefined;

/**
 * A guard that reports whether a request context's lifetime is still open.
 *
 * The platform supplies it beside the accessor, so a request-scoped resolution
 * after the response boundary fails with `STALE_LIFETIME` instead of writing
 * into a cache map nobody will read again.
 */
export type RequestContextGuard = (context: object) => boolean;

const UNSET_SLOT = Symbol("aponia.unset-request-slot");

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
  readonly #rootSingletons = new Map<Token<unknown>, unknown>();
  readonly #controllers = new Map<ModuleDefinition, Map<ControllerDefinition, unknown>>();
  readonly #resolving: ProviderLocation[] = [];
  readonly #requestSlotIds = new Map<ModuleDefinition, Map<Provider, number>>();
  readonly #requestSlotValues = new WeakMap<object, unknown[]>();
  #nextRequestSlotId = 0;
  readonly #requestControllers = new WeakMap<
    object,
    Map<ModuleDefinition, Map<ControllerDefinition, unknown>>
  >();
  readonly #requestsByContextId = new WeakMap<object, object>();
  #contextAccessor?: RequestContextAccessor;
  #contextGuard?: RequestContextGuard;

  constructor(graph: ModuleGraph) {
    this.graph = graph;
  }

  /**
   * Sets the ambient request context accessor used to resolve request-scoped providers.
   *
   * @param accessor - Function returning the active request context object, or undefined.
   * @param isOpen - Reports whether a context's lifetime is still open; a closed
   * context refuses a request-scoped resolution with `STALE_LIFETIME`.
   */
  setRequestContextAccessor(
    accessor: RequestContextAccessor | undefined,
    isOpen?: RequestContextGuard,
  ): void {
    this.#contextAccessor = accessor;
    this.#contextGuard = isOpen;
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
  providerScope(module: ModuleDefinition, provider: Provider): NormalizedProviderScope {
    const declared = normalizeProviderScope(provider.scope);
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
  ): Exclude<NormalizedProviderScope, "transient"> {
    if (normalizeProviderScope(controller.scope) === "request") {
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
      if (this.graph.requiresRequestContext(location.module, location.provider)) {
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
    if (context === undefined && this.#rootSingletons.has(token)) {
      return this.#rootSingletons.get(token) as T;
    }
    this.#assertNotApplicationEnhancerToken(token);
    if (token === ModuleRef) {
      return new ContainerModuleRef(this, this.graph.root) as T;
    }
    if (this.#isContextToken(token)) {
      return this.#resolveContextToken(token, context ?? this.#contextAccessor?.()) as T;
    }
    const location = this.graph.locate(this.graph.root, token);
    const instance = this.#resolve(location, context) as T;
    if (
      context === undefined &&
      this.providerScope(location.module, location.provider) === "singleton"
    ) {
      this.#rootSingletons.set(token, instance);
    }
    return instance;
  }

  /**
   * Resolves one provider record in its module, bypassing token lookup.
   *
   * A module may declare several providers under one `APP_*` token; that token
   * has no single location, so the platform reads each record directly.
   *
   * @internal
   */
  resolveProvider<T>(module: ModuleDefinition, provider: Provider, context?: object): T {
    return this.#resolve({ module, provider }, context) as T;
  }

  /**
   * Every provider a module declares under one token, in declaration order.
   *
   * @internal
   */
  providersFor(module: ModuleDefinition, token: Token<unknown>): readonly Provider[] {
    return Object.freeze(module.providers.filter((provider) => provider.provide === token));
  }

  /**
   * Resolves every provider a module declares under one token.
   *
   * @internal
   */
  resolveAllInModule<T>(module: ModuleDefinition, token: Token<T>, context?: object): readonly T[] {
    const resolved: T[] = [];
    for (const owner of this.#reachableModules(module)) {
      for (const provider of this.providersFor(owner, token)) {
        resolved.push(this.#resolve({ module: owner, provider }, context) as T);
      }
    }
    return Object.freeze(resolved);
  }

  /**
   * Records the request object a context id resolves `REQUEST` to.
   *
   * Mirrors Nest's `ModuleRef.registerRequestByContextId`: a caller that
   * resolves `REQUEST` with this context id receives `request`, and
   * `ContextIdFactory.getByRequest` reads the same id back off it.
   *
   * @param request - The request object.
   * @param contextId - The context id the request resolves under.
   */
  registerRequestByContextId(request: object, contextId: ContextId): void {
    this.#requestsByContextId.set(contextId, request);
    try {
      Object.defineProperty(request, REQUEST_CONTEXT_ID, {
        value: contextId,
        enumerable: false,
        writable: false,
        configurable: false,
      });
    } catch {
      // A frozen request still resolves through the context-id map.
    }
  }

  /**
   * Framework platform SPI for resolving a provider in its owning module.
   * Application code should use get(), which enforces root-module visibility.
   *
   * @internal
   */
  resolveModuleProvider<T>(module: ModuleDefinition, token: Token<T>, context?: object): T {
    this.#assertNotApplicationEnhancerToken(token);
    if (token === ModuleRef) {
      return new ContainerModuleRef(this, module) as T;
    }
    if (this.#isContextToken(token)) {
      return this.#resolveContextToken(token, context ?? this.#contextAccessor?.()) as T;
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
    this.#assertNotApplicationEnhancerToken(token);
    if (token === ModuleRef) {
      return new ContainerModuleRef(this, module) as T;
    }
    if (this.#isContextToken(token)) {
      return this.#resolveContextToken(token, context ?? this.#contextAccessor?.()) as T;
    }

    const location = this.graph.locate(module, token);
    assertSupportedScope(location.provider);

    const scope = this.providerScope(location.module, location.provider);
    const activeContext = context ?? this.#contextAccessor?.();
    if (scope === "request") {
      if (!activeContext) {
        throw new AponiaError(
          "MISSING_REQUEST_CONTEXT",
          `Cannot create request-scoped provider "${getTokenName(location.provider.provide)}" outside of an active request context.`,
          {
            module: location.module.id,
            token: getTokenName(location.provider.provide),
          },
        );
      }
      this.#assertContextOpen(activeContext, location.module, location.provider.provide);
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
   * Instantiates a module's singleton providers, awaiting asynchronous factories.
   *
   * A `useFactory` may return a Promise, as Nest's does. The boot calls this
   * pass, so every provider an application later reads is already resolved: the
   * synchronous `get` path never has to wait, and never hands out a Promise.
   *
   * @param module - The module whose singleton providers to instantiate.
   * @returns A promise that settles once every provider of the module exists.
   *
   * @internal
   */
  async initializeModuleAsync(module: ModuleDefinition): Promise<void> {
    for (const provider of module.providers) {
      assertSupportedScope(provider);
      if (this.providerScope(module, provider) !== "singleton") {
        continue;
      }
      await this.#resolveAsync({ module, provider });
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
      this.#assertContextOpen(activeContext, module, controller.token);
      const cacheContext = this.#durableContext(activeContext, controller);

      let contextModules = this.#requestControllers.get(cacheContext);
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
        this.#requestControllers.set(cacheContext, contextModules);
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
    let cacheContext = activeContext;

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
      this.#assertContextOpen(activeContext, location.module, location.provider.provide);
      cacheContext = this.#durableContext(activeContext, location.provider);

      const slotId = this.#getRequestSlotId(location.module, location.provider);
      const slots = this.#requestSlotValues.get(cacheContext);
      if (slots !== undefined && slotId < slots.length && slots[slotId] !== UNSET_SLOT) {
        return slots[slotId];
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
      assertSynchronous(instance, location.provider);

      if (scope === "request") {
        const slotId = this.#getRequestSlotId(location.module, location.provider);
        let slots = this.#requestSlotValues.get(cacheContext!);
        if (slots === undefined) {
          slots = [];
          this.#requestSlotValues.set(cacheContext!, slots);
        }
        while (slots.length <= slotId) {
          slots.push(UNSET_SLOT);
        }
        slots[slotId] = instance;
      } else if (scope !== "transient") {
        this.#moduleCache(this.#instances, location.module).set(location.provider, instance);
      }

      return instance;
    } finally {
      this.#resolving.pop();
    }
  }

  /**
   * Resolves one provider through the asynchronous path the boot uses.
   *
   * The method is the singleton half of {@link #resolve}: request-scoped and
   * transient lifetimes are returned by the synchronous path, whose caller
   * already runs inside a request or asked for a fresh instance. Only a
   * singleton can be built once and awaited at boot.
   */
  async #resolveAsync(location: ProviderLocation): Promise<unknown> {
    assertSupportedScope(location.provider);

    const scope = this.providerScope(location.module, location.provider);
    if (scope !== "singleton") {
      return this.#resolve(location);
    }

    const moduleInstances = this.#instances.get(location.module);
    if (moduleInstances?.has(location.provider)) {
      return moduleInstances.get(location.provider);
    }

    this.#assertNoProviderCycle(location);
    this.#resolving.push(location);
    try {
      const dependencies: unknown[] = [];
      for (const dependency of getProviderDependencies(location.provider)) {
        dependencies.push(await this.#resolveDependencyAsync(location.module, dependency));
      }
      const instance = await instantiate(location.provider, dependencies);

      this.#moduleCache(this.#instances, location.module).set(location.provider, instance);
      return instance;
    } finally {
      this.#resolving.pop();
    }
  }

  /** The asynchronous counterpart of {@link #resolveDependency}. */
  async #resolveDependencyAsync(
    module: ModuleDefinition,
    dependency: InjectionDependency,
  ): Promise<unknown> {
    const optional = isOptionalInjection(dependency);
    const token = optional ? dependency.token : dependency;

    if (this.#isContextToken(token)) {
      try {
        return this.#resolveContextToken(token, this.#contextAccessor?.());
      } catch (error) {
        if (optional && error instanceof AponiaError && error.code === "MISSING_REQUEST_CONTEXT") {
          return undefined;
        }
        throw error;
      }
    }

    if (token === ModuleRef) {
      return new ContainerModuleRef(this, module);
    }

    try {
      const location = this.graph.locate(module, resolveForwardRef(token));
      const inResolving = this.#resolving.some(
        (item) => item.module === location.module && item.provider === location.provider,
      );
      if (inResolving && isForwardRef(token)) {
        return this.#createForwardRefProxy(location);
      }
      return await this.#resolveAsync(location);
    } catch (error) {
      if (optional && error instanceof AponiaError && error.code === "MISSING_PROVIDER") {
        return undefined;
      }
      throw error;
    }
  }

  #createForwardRefProxy(location: ProviderLocation, context?: object): unknown {
    const resolveInstance = (): unknown =>
      this.resolveModuleProvider(location.module, location.provider.provide, context);
    const target = {};
    return new Proxy(target, {
      get(_target, prop, receiver) {
        if (prop === "then") {
          return undefined;
        }
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

    if (this.#isContextToken(token)) {
      try {
        return this.#resolveContextToken(token, context ?? this.#contextAccessor?.());
      } catch (error) {
        if (optional && error instanceof AponiaError && error.code === "MISSING_REQUEST_CONTEXT") {
          return undefined;
        }
        throw error;
      }
    }

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

  /** Whether a token is one of the request-context tokens the container answers itself. */
  #isContextToken(token: unknown): boolean {
    return token === REQUEST || token === CONTEXT || token === INQUIRER;
  }

  /** Answers `REQUEST`, `CONTEXT`, or `INQUIRER` from the active request. */
  #resolveContextToken(token: unknown, context: object | undefined): unknown {
    if (token === CONTEXT) {
      if (context === undefined) {
        throw missingRequestContext("CONTEXT");
      }
      return context;
    }
    if (token === REQUEST) {
      if (context === undefined) {
        throw missingRequestContext("REQUEST");
      }
      const registered = this.#requestsByContextId.get(context);
      if (registered !== undefined) {
        return registered;
      }
      const request = (context as { readonly request?: unknown }).request;
      return request ?? context;
    }

    // INQUIRER: the provider currently being constructed is the one that asked.
    // Its instance does not exist yet, so the answer is a forward reference.
    const current = this.#resolving.at(-1);
    if (current === undefined) {
      throw missingRequestContext("INQUIRER");
    }
    return this.#createForwardRefProxy(current, context);
  }

  /** Assigns a dense integer slot index for flat request-scoped array caching. */
  #getRequestSlotId(module: ModuleDefinition, provider: Provider): number {
    let moduleSlots = this.#requestSlotIds.get(module);
    if (moduleSlots === undefined) {
      moduleSlots = new Map();
      this.#requestSlotIds.set(module, moduleSlots);
    }
    let slotId = moduleSlots.get(provider);
    if (slotId === undefined) {
      slotId = this.#nextRequestSlotId;
      this.#nextRequestSlotId += 1;
      moduleSlots.set(provider, slotId);
    }
    return slotId;
  }

  /** Refuses reading an `APP_*` pseudo-provider as if it had one instance. */
  #assertNotApplicationEnhancerToken(token: unknown): void {
    if (!isApplicationEnhancerToken(token)) {
      return;
    }
    throw new AponiaError(
      "MISSING_PROVIDER",
      `Token "${getTokenName(token as Token<unknown>)}" is an application-enhancer pseudo-provider and has no single instance to resolve.`,
      {
        token: getTokenName(token as Token<unknown>),
        pseudoProvider: true,
        hints: Object.freeze([
          "Declare the enhancer through the application options or another token.",
        ]),
      },
    );
  }

  /** The context a durable provider caches under, resolved by the strategy. */
  #durableContext(
    context: object,
    component: { readonly durable?: boolean; readonly provide?: unknown; readonly token?: unknown },
  ): object {
    const getParent = (context as { readonly getParent?: (info: HostComponentInfo) => ContextId })
      .getParent;
    if (typeof getParent !== "function") {
      return context;
    }
    return getParent({
      token: component.provide ?? component.token,
      isTreeDurable: component.durable === true,
    }) as object;
  }

  /** The module and every module its imports reach, plus global modules. */
  #reachableModules(module: ModuleDefinition): readonly ModuleDefinition[] {
    const reached = new Set<ModuleDefinition>([module]);
    const queue: ModuleDefinition[] = [module];
    for (let index = 0; index < queue.length; index += 1) {
      for (const rawImport of queue[index]!.imports) {
        if (isForwardRef(rawImport)) {
          continue;
        }
        if (!reached.has(rawImport)) {
          reached.add(rawImport);
          queue.push(rawImport);
        }
      }
    }
    for (const globalModule of this.graph.globalModules) {
      reached.add(globalModule);
    }
    return Object.freeze([...reached]);
  }

  /** Refuses a request-scoped resolution whose context lifetime has ended. */
  #assertContextOpen(context: object, module: ModuleDefinition, token: InjectionDependency): void {
    if (this.#contextGuard === undefined || this.#contextGuard(context)) {
      return;
    }
    throw new AponiaError(
      "STALE_LIFETIME",
      `Cannot resolve request-scoped "${getTokenName(token)}" from a request context whose lifetime has ended.`,
      {
        module: module.id,
        token: getTokenName(token),
        reason: "closed",
      },
    );
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
      provideValue(REQUEST, undefined),
      provideValue(CONTEXT, undefined),
      provideValue(INQUIRER, undefined),
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

  get<T>(token: Token<T>, options: ModuleRefGetOptions = {}): T {
    const strict = options.strict ?? true;
    if (options.each === true) {
      return this.#container.resolveAllInModule(
        strict ? this.#module : this.#container.graph.root,
        token,
      ) as unknown as T;
    }
    if (!strict) {
      return this.#container.get(token);
    }
    return this.#container.resolveModuleProvider(this.#module, token);
  }

  resolve<T>(token: Token<T>, contextId?: object): T {
    return this.#container.resolveModuleProvider(
      this.#module,
      token,
      contextId ?? ContextIdFactory.create(),
    );
  }

  create<T>(token: Token<T>, contextId?: object): T {
    return this.#container.createInModule(this.#module, token, contextId);
  }

  registerRequestByContextId<TRequest extends object>(request: TRequest, contextId: object): void {
    this.#container.registerRequestByContextId(request, contextId as ContextId);
  }
}

/** The failure a context token raises outside a request. */
function missingRequestContext(token: string): AponiaError {
  return new AponiaError(
    "MISSING_REQUEST_CONTEXT",
    `Cannot resolve "${token}" outside of an active request context.`,
    { token },
  );
}

/**
 * Refuses a synchronous resolution that produced a Promise.
 *
 * An asynchronous `useFactory` is awaited by the boot's own pass. A token read
 * through the synchronous path before that pass — or a factory that returns a
 * Promise on a request-scoped provider — would otherwise be cached as a
 * Promise, and every injection would carry one. The refusal names the provider
 * instead.
 */
function assertSynchronous(instance: unknown, provider: Provider): void {
  if (typeof (instance as Promise<unknown> | undefined)?.then !== "function") {
    return;
  }
  throw new AponiaError(
    "ASYNC_PROVIDER_RESOLUTION",
    `Provider "${getTokenName(provider.provide)}" returns a Promise from its factory, which the synchronous resolution path cannot await. Read it after the boot, or use a singleton scope.`,
    { token: getTokenName(provider.provide), scope: provider.scope ?? "singleton" },
  );
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
  const declared = provider.scope;
  if (
    declared === undefined ||
    declared === Scope.DEFAULT ||
    declared === Scope.REQUEST ||
    declared === Scope.TRANSIENT ||
    declared === "singleton" ||
    declared === "request" ||
    declared === "transient"
  ) {
    return;
  }

  throw new AponiaError(
    "UNSUPPORTED_PROVIDER_SCOPE",
    `Provider "${getTokenName(provider.provide)}" declares scope "${String(declared)}", which this release does not instantiate.`,
    {
      token: getTokenName(provider.provide),
      scope: String(declared),
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
