import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  AponiaError,
  getCatchMetadata,
  getControllerMetadata,
  getWebSocketServerProperties,
  type CanActivate,
  type ClassToken,
  type ExceptionFilter,
  type Interceptor,
  type ModuleDefinition,
  type Token,
} from "@aponiajs/common";
import { createContainer, type AponiaContainer } from "@aponiajs/core";
import type { PlatformHost } from "../host/platform-host.types.ts";
import type { HostRequestInfo, HttpKernel, MountedRoute } from "../kernel/kernel.types.ts";
import { createHttpKernel } from "../kernel/http-kernel.ts";
import { resolveApplicationPipes, resolvePipe } from "../pipes/pipe-resolver.ts";
import { compileRootModule, HttpControllerKind } from "../modules/module-compiler.ts";
import type { AponiaRootModule } from "../modules/module-compiler.types.ts";
import type { AponiaAdapter, AponiaApplicationContract } from "../host/platform-host.types.ts";
import { compileRoutes } from "../routing/route-compilation.ts";
import { createGatewayDispatcher, injectGatewayServer } from "../websockets/gateway-dispatch.ts";
import { compileGatewayPlan } from "../websockets/gateway-plan.ts";
import { joinPaths } from "../routing/route-path.ts";
import { normalizeRoutePrefix } from "../routing/route-prefix.ts";
import type { AponiaHttpApplicationOptions } from "./application.types.ts";
import {
  attachApplicationShutdown,
  collectLifecycleCalls,
  type ApplicationShutdown,
} from "./lifecycle-hooks.ts";

/** What one boot produced. */
export interface BootedHttpApplication<TNative = unknown> {
  /** The native application the host created. */
  readonly native: TNative;
  /** The kernel that serves it. */
  readonly kernel: HttpKernel;
  /** The container the graph was built in. */
  readonly container: AponiaContainer;
  /** The frozen root descriptor. */
  readonly root: ModuleDefinition;
  /** The shutdown plan a `close()` runs. */
  readonly shutdown: ApplicationShutdown;
  /** The mounts the kernel serves, in mount order. */
  readonly routes: readonly MountedRoute[];
}

function createShutdown(container: AponiaContainer): ApplicationShutdown {
  return async (_closeActiveConnections?: boolean, signal?: string): Promise<void> => {
    for (const call of collectLifecycleCalls(container, "beforeApplicationShutdown")) {
      await call(signal);
    }
    for (const call of [...collectLifecycleCalls(container, "onModuleDestroy")].reverse()) {
      await call();
    }
    for (const call of collectLifecycleCalls(container, "onApplicationShutdown")) {
      await call(signal);
    }
  };
}

function resolveGlobal<T>(container: AponiaContainer, token: Token<unknown>): readonly T[] {
  try {
    container.graph.locate(container.graph.root, token);
  } catch (error) {
    if (error instanceof AponiaError && error.code === "MISSING_PROVIDER") {
      return Object.freeze([]);
    }
    throw error;
  }

  const value = container.resolveModuleProvider(container.graph.root, token);
  return Object.freeze(
    entriesOf(value).map((entry) => resolveInstance<T>(container, container.graph.root, entry)),
  );
}

function resolveClasses<T>(
  container: AponiaContainer,
  module: ModuleDefinition,
  classes: readonly ClassToken<unknown>[],
): readonly T[] {
  return Object.freeze(classes.map((entry) => resolveInstance<T>(container, module, entry)));
}

function resolveInstance<T>(
  container: AponiaContainer,
  module: ModuleDefinition,
  entry: unknown,
): T {
  if (typeof entry === "function") {
    try {
      return container.resolveModuleProvider(module, entry as Token<unknown>) as T;
    } catch (error) {
      // A global enhancer stated as a class rather than an instance is built
      // here; a class the graph does provide is resolved above.
      if (error instanceof AponiaError && error.code === "MISSING_PROVIDER") {
        return Reflect.construct(entry, []) as T;
      }
      throw error;
    }
  }
  return entry as T;
}

function entriesOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * One managed application served by a host.
 */
export class AponiaHttpApplication<TNative = unknown> {
  readonly #kernel: HttpKernel;
  readonly #native: TNative;
  readonly #container: AponiaContainer;
  readonly #shutdown: ApplicationShutdown;
  readonly #host: PlatformHost<TNative, unknown> | undefined;
  #closed = false;
  #url: string | undefined;
  #listener: { readonly url: string; close(force?: boolean): Promise<void> } | undefined;

  /** @internal */
  constructor(
    host: PlatformHost<TNative, unknown> | undefined,
    booted: BootedHttpApplication<TNative>,
  ) {
    this.#host = host;
    this.#kernel = booted.kernel;
    this.#native = booted.native;
    this.#container = booted.container;
    this.#shutdown = booted.shutdown;
  }

  /** Answers one request through the kernel. */
  handle(request: Request, info?: HostRequestInfo): Promise<Response> {
    return this.#kernel.handle(request, info);
  }

  /** Answers a request the kernel has a route for, or declines it. */
  tryHandle(request: Request, info?: HostRequestInfo): Promise<Response | undefined> {
    return this.#kernel.tryHandle(request, info);
  }

  /** The runtime's own application object. */
  getHttpAdapter(): TNative {
    return this.#native;
  }

  /** The native application the host created; `getHttpAdapter()` by another name. */
  getNativeApplication(): TNative {
    return this.#native;
  }

  /** Resolves a token the graph provides. */
  get<T>(token: Token<T>): T {
    return this.#container.get(token);
  }

  /**
   * Binds a port and resolves with the application itself.
   *
   * @param port - The port to bind, or `0` for one the runtime picks.
   * @returns This application, so `listen` reads as the last step of a chain.
   * @throws `UNSUPPORTED_PLATFORM_FEATURE` when the host has no listener.
   */
  async listen(port: number): Promise<this> {
    if (this.#host?.listen === undefined) {
      throw new AponiaError(
        "UNSUPPORTED_PLATFORM_FEATURE",
        `The ${this.#host?.name ?? "mounted"} host does not provide a listener.`,
        { feature: "listen" },
      );
    }
    this.#listener = await this.#host.listen(this.#native, port);
    this.#url = this.#listener.url;
    return this;
  }

  /**
   * The address the application is listening on.
   *
   * @returns The URL the host bound.
   * @throws `APPLICATION_NOT_LISTENING` before `listen`.
   */
  getUrl(): string {
    if (this.#url === undefined) {
      throw new AponiaError(
        "APPLICATION_NOT_LISTENING",
        "The application is not listening; call listen() first.",
        {},
      );
    }
    return this.#url;
  }

  /** The runtime's name, when a host created this application. */
  get platform(): string | undefined {
    return this.#host?.name;
  }

  /** Runs the shutdown plan once. */
  async close(force = false): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (this.#listener !== undefined) {
      await this.#listener.close(force);
    }
    await this.#shutdown(force);
    if (this.#host?.close !== undefined) {
      await this.#host.close(this.#native);
    }
  }
}

/**
 * The one factory an application calls, whichever runtime serves it.
 *
 * An adapter states the runtime: a kernel host boots the graph into the shared
 * kernel, while an application adapter (the Elysia platform) boots through its
 * own executor so its native features stay reachable. Both return the same
 * application surface.
 */
export const AponiaFactory = Object.freeze({
  /**
   * Boots an application on the adapter the options state.
   *
   * @param rootModule - The root module.
   * @param options - The boot options, including the runtime adapter.
   * @returns The application.
   */
  async create<TNative = unknown>(
    rootModule: AponiaRootModule,
    options: AponiaHttpApplicationOptions & { readonly adapter: AponiaAdapter<TNative> },
  ): Promise<AponiaApplicationContract<TNative>> {
    const adapter = options.adapter;
    if (adapter.kind === "application") {
      return await adapter.create(rootModule, options);
    }
    return (await createPlatformFactory(
      adapter as unknown as Parameters<typeof createPlatformFactory<TNative>>[0],
    ).create(rootModule, options)) as AponiaApplicationContract<TNative>;
  },
});

/**
 * Builds the factory one platform exposes, over the host it implements.
 *
 * @param host - The runtime binding.
 * @returns `create`, `createNative`, and `createApplicationContext`-shaped entry points.
 */
export function createPlatformFactory<TNative>(host: PlatformHost<TNative, unknown>) {
  return Object.freeze({
    /**
     * Boots an application and returns the managed wrapper.
     *
     * @param rootModule - The root module.
     * @param options - Boot options.
     * @returns The application.
     */
    async create(
      rootModule: AponiaRootModule,
      options: AponiaHttpApplicationOptions = {},
    ): Promise<AponiaHttpApplication<TNative>> {
      return await boot(rootModule, options);
    },
    /**
     * Boots an application and returns the native one, with the dispatcher mounted.
     *
     * @param rootModule - The root module.
     * @param options - Boot options.
     * @returns The native application.
     */
    async createNative(rootModule: AponiaRootModule, options: AponiaHttpApplicationOptions = {}) {
      return (await boot(rootModule, options)).getNativeApplication();
    },
  });

  async function boot(
    rootModule: AponiaRootModule,
    options: AponiaHttpApplicationOptions,
  ): Promise<AponiaHttpApplication<TNative>> {
    const compiledRoot = compileRootModule(rootModule);
    const container = createContainer(compiledRoot);
    const prefix = normalizeRoutePrefix(options.prefix);

    for (const module of container.graph.modules) {
      container.initializeModule(module);
    }

    const native = host.createApplication(compiledRoot.id);
    const configured =
      options.configureNative === undefined
        ? native
        : (options.configureNative(native as never) as TNative);

    const globalGuards = resolveGlobal<CanActivate>(container, APP_GUARD);
    const globalInterceptors = resolveGlobal<Interceptor>(container, APP_INTERCEPTOR);
    const globalFilters = resolveGlobal<ExceptionFilter>(container, APP_FILTER).map((instance) =>
      Object.freeze({
        instance,
        exceptions: getCatchMetadata(instance.constructor as ClassToken<unknown>),
      }),
    );
    const globalPipes = resolveApplicationPipes(container);

    const routes: MountedRoute[] = [];
    for (const module of container.graph.modules) {
      for (const definition of module.controllers) {
        if (definition.kind !== HttpControllerKind) {
          continue;
        }
        const token = definition.token as ClassToken<unknown>;
        // The lowering refuses an undecorated controller, so one reaching this
        // point carries the metadata the route compiler reads.
        const metadata = getControllerMetadata(token)!;
        const compiled = compileRoutes(token, metadata.path);
        const requestScoped = container.controllerScope(module, definition) === "request";
        const instance = requestScoped
          ? undefined
          : container.instantiateController(module, definition);

        for (const route of compiled) {
          routes.push(
            Object.freeze({
              route: Object.freeze({
                ...route,
                path: prefix === "" ? route.path : joinPaths(prefix, route.path),
              }),
              controller: token,
              instance,
              ...(requestScoped
                ? {
                    resolveInstance: (context: object) =>
                      container.instantiateController(module, definition, context),
                  }
                : {}),
              guards: Object.freeze([
                ...globalGuards,
                ...resolveClasses<CanActivate>(container, module, route.enhancers.guards),
              ]),
              interceptors: Object.freeze([
                ...globalInterceptors,
                ...resolveClasses<Interceptor>(container, module, route.enhancers.interceptors),
              ]),
              filters: Object.freeze([
                ...resolveClasses<ExceptionFilter>(container, module, route.enhancers.filters).map(
                  (filter) =>
                    Object.freeze({
                      instance: filter,
                      exceptions: getCatchMetadata(filter.constructor as ClassToken<unknown>),
                    }),
                ),
                ...globalFilters,
              ]),
              pipes: Object.freeze(route.pipes.map((pipe) => resolvePipe(pipe, container))),
            }),
          );
        }
      }
    }

    const logger = options.logger === false ? undefined : options.logger;
    const kernel = createHttpKernel({
      routes,
      ...(logger === undefined ? {} : { logger }),
      ...(options.state === undefined ? {} : { store: options.state }),
      ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
      ...(options.middleware === undefined ? {} : { middleware: options.middleware }),
      ...(options.renderView === undefined ? {} : { renderView: options.renderView }),
      globalPipes,
    });

    host.mount(configured, async (request, info) => await kernel.tryHandle(request, info));

    const gatewayInits: (() => void | Promise<void>)[] = [];
    const gatewayPaths = new Set<string>();
    const gatewayEvents = new Set<string>();
    for (const module of container.graph.modules) {
      for (const provider of module.providers) {
        if (provider.kind !== "class") {
          continue;
        }
        const plan = compileGatewayPlan(provider.useClass);
        if (plan === undefined) {
          continue;
        }
        if (host.mountGateway === undefined) {
          throw new AponiaError(
            "UNSUPPORTED_PLATFORM_FEATURE",
            `The ${host.name} platform does not support WebSocket gateways.`,
            {
              platform: host.name,
              feature: "websockets",
              gateway: provider.useClass.name,
              path: plan.path,
            },
          );
        }
        if (gatewayPaths.has(plan.path)) {
          throw new AponiaError(
            "DUPLICATE_WEBSOCKET_GATEWAY",
            `Two gateways answer on "${plan.path}".`,
            { path: plan.path },
          );
        }
        gatewayPaths.add(plan.path);
        for (const handler of plan.handlers) {
          if (gatewayEvents.has(handler.event)) {
            throw new AponiaError(
              "DUPLICATE_WEBSOCKET_HANDLER",
              `Two gateways answer the event "${handler.event}".`,
              { event: handler.event },
            );
          }
          gatewayEvents.add(handler.event);
        }

        const instance = container.resolveModuleProvider(module, provider.provide) as Record<
          PropertyKey,
          unknown
        >;
        const guards = plan.guards.map(
          (guard) => container.resolveModuleProvider(module, guard) as CanActivate,
        );
        injectGatewayServer(instance, getWebSocketServerProperties(provider.useClass), configured);
        const dispatcher = createGatewayDispatcher(instance, plan, guards, configured);
        host.mountGateway(configured, plan, dispatcher);
        gatewayInits.push(() => dispatcher.afterInit());
      }
    }
    for (const afterInit of gatewayInits) {
      await afterInit();
    }

    for (const call of collectLifecycleCalls(container, "onModuleInit")) {
      await call();
    }
    const shutdown = createShutdown(container);
    attachApplicationShutdown(configured as object, shutdown);
    for (const call of collectLifecycleCalls(container, "onApplicationBootstrap")) {
      await call();
    }

    const booted: BootedHttpApplication<TNative> = {
      native: configured,
      kernel,
      container,
      root: compiledRoot,
      shutdown,
      routes,
    };
    return new AponiaHttpApplication(host, booted);
  }
}
