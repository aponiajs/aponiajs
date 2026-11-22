import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  AponiaError,
  LOGGER,
  Logger,
  NOOP_LOGGER,
  Reflector,
  getCatchMetadata,
  getControllerMetadata,
  getWebSocketServerProperties,
  provideClass,
  provideValue,
  type CanActivate,
  type ClassToken,
  type ExceptionFilter,
  type Interceptor,
  type LoggerService,
  type ModuleDefinition,
  type Token,
} from "@aponiajs/common";
import { createContainer, type AponiaContainer } from "@aponiajs/core";
import { attachApplicationContainer } from "./application-container.ts";
import type {
  AponiaAdapter,
  AponiaApplicationContract,
  PlatformHost,
  RequestPipeline,
} from "../host/platform-host.types.ts";
import type {
  HostRequestInfo,
  MountedRoute,
  PlatformRouteContext,
  ResolvedFilter,
} from "../kernel/kernel.types.ts";
import { createRouteHandler } from "../kernel/http-kernel.ts";
import {
  resolveApplicationPipe,
  resolveApplicationPipes,
  resolvePipe,
} from "../pipes/pipe-resolver.ts";
import { compileRootModule, HttpControllerKind } from "../modules/module-compiler.ts";
import type { AponiaRootModule } from "../modules/module-compiler.types.ts";
import { compileRoutes } from "../routing/route-compilation.ts";
import { createGatewayDispatcher, injectGatewayServer } from "../websockets/gateway-dispatch.ts";
import { compileGatewayPlan } from "../websockets/gateway-plan.ts";
import type { GatewayPlan } from "../websockets/gateway.types.ts";
import { joinPaths } from "../routing/route-path.ts";
import { normalizeRoutePrefix } from "../routing/route-prefix.ts";
import { createVersionNegotiator } from "../routing/version-negotiation.ts";
import { normalizeStaticAssets } from "../routing/static-assets.ts";
import { applyHttpPolicies, corsPreflight, resolveHttpPolicies } from "../policy/http-policy.ts";
import type { ResolvedHttpPolicies } from "../policy/http-policy.types.ts";
import type {
  VersionNegotiationRoute,
  VersionNegotiator,
} from "../routing/version-negotiation.types.ts";
import { createRouteMatcher, type RouteMatcher } from "../kernel/route-matcher.ts";
import { createMiddlewareConsumer } from "../middleware/middleware-consumer.ts";
import {
  collectModuleMiddleware,
  resolveMiddlewareInstance,
  runMiddlewareChain,
} from "../middleware/route-matching.ts";
import type { ResolvedMiddlewareConfig } from "../middleware/middleware-consumer.types.ts";
import type { AponiaHttpApplicationOptions, AponiaListenOptions } from "./application.types.ts";
import {
  attachApplicationShutdown,
  collectLifecycleCalls,
  type ApplicationShutdown,
  type LifecycleCall,
} from "./lifecycle-hooks.ts";
import { installShutdownSignalHandlers } from "./shutdown-signals.ts";
import { REQUEST_CONTEXT_REGISTRATION } from "../request-context/request-context-module.ts";
import type { RequestContextRegistration } from "../request-context/request-context.types.ts";
import { applyPlatformModules, PLATFORM_ADAPTER_HOST } from "../plugins/platform-module.ts";
import { ApplicationReadiness, compileHealthProbes } from "../health/health-probes.ts";

/** What one boot produced. */
export interface BootedHttpApplication<TNative = unknown> {
  /** The native application the host created. */
  readonly native: TNative;
  /** The matcher a `tryHandle` consults. */
  readonly matcher: RouteMatcher;
  /** The container the graph was built in. */
  readonly container: AponiaContainer;
  /** The frozen root descriptor. */
  readonly root: ModuleDefinition;
  /** The shutdown plan a `close()` runs. */
  readonly shutdown: ApplicationShutdown;
  /** The mounts the platform registered, in mount order. */
  readonly routes: readonly MountedRoute[];
  /** The listener the application bound, shared with the shutdown plan. */
  readonly listener: ListenerRef;
  /** The flag this boot's readiness probe reads. */
  readonly readiness: ApplicationReadiness;
  /** The compiled version negotiator, when header or media-type versioning is on. */
  readonly versionNegotiator?: VersionNegotiator | undefined;
  /** The response policies the boot resolved, when the application states any. */
  readonly policies?: ResolvedHttpPolicies | undefined;
}

/** Where a listening application keeps the listener its shutdown plan stops. */
export interface ListenerRef {
  current?: { readonly url: string; close(force?: boolean): Promise<void> } | undefined;
}

function reportFailure(logger: unknown, error: unknown): void {
  try {
    (logger as { error?: (failure: unknown, context?: string) => void } | undefined)?.error?.(
      error,
      "ApplicationShutdown",
    );
  } catch {
    // A logger that refuses may not stop the shutdown plan.
  }
}

async function runHooks(
  calls: readonly LifecycleCall[],
  logger: unknown,
  signal?: string,
): Promise<void> {
  for (const call of calls) {
    try {
      await call(signal);
    } catch (error) {
      reportFailure(logger, error);
    }
  }
}

/**
 * Builds the shutdown plan a boot attaches.
 *
 * The order is Nest's: `beforeApplicationShutdown`, then the listener stops,
 * then `onModuleDestroy` reversed, then `onApplicationShutdown`. A hook that
 * throws is reported and the remaining hooks still run.
 */
function createShutdown(
  container: AponiaContainer,
  logger: unknown,
  stop: (force?: boolean) => Promise<void>,
): ApplicationShutdown {
  const before = collectLifecycleCalls(container, "beforeApplicationShutdown");
  const destroy = [...collectLifecycleCalls(container, "onModuleDestroy")].reverse();
  const after = collectLifecycleCalls(container, "onApplicationShutdown");
  let closed = false;

  return async (force = true, signal?: string): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    await runHooks(before, logger, signal);
    await stop(force);
    await runHooks(destroy, logger);
    await runHooks(after, logger, signal);
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
  return Object.freeze(entriesOf(value).map((entry) => resolveGlobalInstance<T>(container, entry)));
}

/**
 * Resolves one value provided under a global enhancer token.
 *
 * A class provided as a value is constructed when the graph does not provide
 * it, which is the low-level shape `APP_GUARD: [GuardClass]` states. A route's
 * own enhancer stays strict: this tolerance belongs only to the application's
 * global declaration.
 */
function resolveGlobalInstance<T>(container: AponiaContainer, entry: unknown): T {
  if (typeof entry === "function") {
    try {
      return container.resolveModuleProvider(container.graph.root, entry as Token<unknown>) as T;
    } catch (error) {
      if (error instanceof AponiaError && error.code === "MISSING_PROVIDER") {
        return Reflect.construct(entry, []) as T;
      }
      throw error;
    }
  }
  return entry as T;
}

function resolveClasses<T>(
  container: AponiaContainer,
  module: ModuleDefinition,
  classes: readonly ClassToken<unknown>[],
): readonly T[] {
  return Object.freeze(classes.map((entry) => resolveInstance<T>(container, module, entry)));
}

function resolveGatewayFilters(
  container: AponiaContainer,
  module: ModuleDefinition,
  plan: GatewayPlan,
): ReadonlyMap<string, readonly ResolvedFilter[]> {
  const resolve = (classes: readonly ClassToken<unknown>[]): readonly ResolvedFilter[] =>
    Object.freeze(
      resolveClasses<ExceptionFilter>(container, module, classes).map((instance) =>
        Object.freeze({
          instance,
          exceptions: getCatchMetadata(instance.constructor as ClassToken<unknown>),
        }),
      ),
    );
  const classFilters = resolve(plan.filters ?? []);
  const byEvent = new Map<string, readonly ResolvedFilter[]>();
  for (const handler of plan.handlers) {
    const merged = Object.freeze([...resolve(handler.filters ?? []), ...classFilters]);
    if (merged.length > 0) {
      byEvent.set(handler.event, merged);
    }
  }
  return byEvent;
}

function resolveInstance<T>(
  container: AponiaContainer,
  module: ModuleDefinition,
  entry: unknown,
): T {
  if (typeof entry === "function") {
    return container.resolveModuleProvider(module, entry as Token<unknown>) as T;
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
  readonly #native: TNative;
  readonly #host: PlatformHost<TNative, unknown>;
  readonly #matcher: RouteMatcher;
  readonly #container: AponiaContainer;
  readonly #shutdown: ApplicationShutdown;
  readonly #listener: ListenerRef;
  readonly #readiness: ApplicationReadiness;
  readonly #logger: unknown;
  readonly #versionNegotiator: VersionNegotiator | undefined;
  readonly #policies: ResolvedHttpPolicies | undefined;
  readonly #pipeline: RequestPipeline | undefined;
  #closed = false;
  #signalsInstalled = false;

  /** @internal */
  constructor(
    host: PlatformHost<TNative, unknown>,
    booted: BootedHttpApplication<TNative>,
    logger: unknown,
  ) {
    this.#host = host;
    this.#native = booted.native;
    this.#matcher = booted.matcher;
    this.#container = booted.container;
    this.#shutdown = booted.shutdown;
    this.#listener = booted.listener;
    this.#readiness = booted.readiness;
    this.#logger = logger;
    this.#versionNegotiator = booted.versionNegotiator;
    this.#policies = booted.policies;
    this.#pipeline = createRequestPipeline(booted.versionNegotiator, booted.policies);
  }

  /** Answers one request through the platform's own router. */
  async handle(request: Request, info?: HostRequestInfo): Promise<Response> {
    if (this.#host.fetch === undefined) {
      throw new AponiaError(
        "UNSUPPORTED_PLATFORM_FEATURE",
        `The ${this.#host.name} platform does not answer raw requests.`,
        { feature: "handle", platform: this.#host.name },
      );
    }
    const fetch = this.#host.fetch.bind(this.#host);
    const dispatch = async (current: Request): Promise<Response> =>
      await fetch(this.#native, current, info);
    return this.#pipeline === undefined
      ? await dispatch(request)
      : await this.#pipeline(request, dispatch);
  }

  /** Answers a request the platform has a route for, or declines it. */
  async tryHandle(request: Request, info?: HostRequestInfo): Promise<Response | undefined> {
    const negotiated = this.#versionNegotiator?.(request);
    if (negotiated instanceof Response) {
      return negotiated;
    }
    const effective = negotiated ?? request;
    if (this.#policies !== undefined) {
      const preflight = corsPreflight(effective, this.#policies);
      if (preflight !== undefined) {
        return preflight;
      }
    }
    const pathname =
      negotiated === undefined
        ? (info?.path ?? new URL(effective.url).pathname)
        : new URL(effective.url).pathname;
    if (this.#matcher.match(effective.method, pathname) === undefined) {
      return undefined;
    }
    return await this.handle(
      effective,
      negotiated === undefined ? info : { ...info, path: pathname },
    );
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
   * @param options - The opt-in stop-signal takeover.
   * @returns This application.
   * @throws `UNSUPPORTED_PLATFORM_FEATURE` when the host has no listener.
   */
  async listen(port: number, options: AponiaListenOptions = {}): Promise<this> {
    if (this.#host.listen === undefined) {
      throw new AponiaError(
        "UNSUPPORTED_PLATFORM_FEATURE",
        `The ${this.#host.name} host does not provide a listener.`,
        { feature: "listen" },
      );
    }
    this.#listener.current = await this.#host.listen(this.#native, port, this.#pipeline);
    if (options.shutdownSignals === true && !this.#signalsInstalled) {
      this.#signalsInstalled = true;
      installShutdownSignalHandlers((signal) => this.close(true, signal), this.#logger as never);
    }
    return this;
  }

  /**
   * The address the application is listening on.
   *
   * @returns The URL the host bound.
   * @throws `APPLICATION_NOT_LISTENING` before `listen`.
   */
  getUrl(): string {
    if (this.#listener.current === undefined) {
      throw new AponiaError(
        "APPLICATION_NOT_LISTENING",
        "The application is not listening; call listen() first.",
        {},
      );
    }
    return this.#listener.current.url;
  }

  /** The runtime's name, when a host created this application. */
  get platform(): string | undefined {
    return this.#host.name;
  }

  /** Runs the shutdown plan once. */
  async close(force = true, signal?: string): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    // Readiness answers `fail` from the moment the stop begins, before the
    // first shutdown hook runs.
    this.#readiness.markShuttingDown();
    await this.#shutdown(force, signal);
    if (this.#host.close !== undefined) {
      await this.#host.close(this.#native);
    }
  }
}

/** The boot options the unified factory takes when the adapter is a field. */
type AponiaBootOptions<TNative> = AponiaHttpApplicationOptions & {
  readonly adapter: AponiaAdapter<TNative>;
};

function isAdapter<TNative>(value: unknown): value is AponiaAdapter<TNative> {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value.kind === "host" || value.kind === "application")
  );
}

/**
 * Boots an application on the adapter the options state.
 *
 * @param rootModule - The root module.
 * @param options - The boot options, including the runtime adapter.
 * @returns The application.
 */
async function createApplication<TNative = unknown>(
  rootModule: AponiaRootModule,
  options: AponiaBootOptions<TNative>,
): Promise<AponiaApplicationContract<TNative>>;
/**
 * Boots an application on the adapter the second argument is.
 *
 * @param rootModule - The root module.
 * @param adapter - The runtime adapter.
 * @param options - The boot options, when any.
 * @returns The application.
 */
async function createApplication<TNative = unknown>(
  rootModule: AponiaRootModule,
  adapter: AponiaAdapter<TNative>,
  options?: AponiaHttpApplicationOptions,
): Promise<AponiaApplicationContract<TNative>>;
async function createApplication<TNative = unknown>(
  rootModule: AponiaRootModule,
  adapterOrOptions: AponiaAdapter<TNative> | AponiaBootOptions<TNative>,
  options: AponiaHttpApplicationOptions = {},
): Promise<AponiaApplicationContract<TNative>> {
  const resolved = isAdapter<TNative>(adapterOrOptions)
    ? { ...options, adapter: adapterOrOptions }
    : adapterOrOptions;
  if (resolved.adapter.kind === "application") {
    return await resolved.adapter.create(rootModule, resolved);
  }
  return (await createPlatformFactory(
    resolved.adapter as unknown as Parameters<typeof createPlatformFactory<TNative>>[0],
  ).create(rootModule, resolved)) as AponiaApplicationContract<TNative>;
}

/**
 * The one factory an application calls, whichever runtime serves it.
 */
export const AponiaFactory = Object.freeze({ create: createApplication });

/**
 * Builds the factory one platform exposes, over the host it implements.
 *
 * @param host - The runtime binding.
 * @returns The `create` and `createNative` entry points.
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
     * Boots an application and returns the native one, with its routes mounted.
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
    const logger = resolveLogger(options.logger);
    const compiledRoot = compileRootModule(rootModule);
    // Created before the container so the running platform is injectable from
    // the first provider that resolves.
    const native = host.createApplication(compiledRoot.id);
    const configured =
      options.configureNative === undefined
        ? native
        : (options.configureNative(native as never) as TNative);
    const container = createContainer(compiledRoot, [
      provideValue(LOGGER, logger ?? NOOP_LOGGER),
      provideValue(
        PLATFORM_ADAPTER_HOST,
        Object.freeze({ platform: host.name, nativeApplication: configured }),
      ),
      provideClass(Reflector, []),
    ]);
    attachApplicationContainer(configured as object, container);
    const requestContext = locateRequestContext(container);
    if (requestContext !== undefined) {
      container.setRequestContextAccessor(
        () => requestContext.service.current(),
        (context) => requestContext.service.isActive(context),
      );
    }
    const prefix = normalizeRoutePrefix(options.prefix);
    const listener: ListenerRef = {};

    for (const module of container.graph.modules) {
      container.initializeModule(module);
    }

    // Refuses an undeclared platform before anything mounts, then runs each
    // package's selected native mount ahead of middleware and routes.
    await applyPlatformModules(container, configured, host.name);

    // Static files answer before middleware, guards, and routes: an asset is
    // fetched without the application's credentials, so no enhancer may sit in
    // front of it. A host that cannot serve files refuses the declaration
    // rather than booting an application that silently lacks it.
    for (const assets of normalizeStaticAssets(options.staticAssets)) {
      if (host.mountStaticAssets === undefined) {
        throw new AponiaError(
          "UNSUPPORTED_PLATFORM_FEATURE",
          `The ${host.name} platform does not serve static assets.`,
          { platform: host.name, feature: "static-assets", prefix: assets.prefix },
        );
      }
      host.mountStaticAssets(configured, assets);
    }

    const optionGuards = resolveClasses<CanActivate>(
      container,
      container.graph.root,
      options.guards ?? [],
    );
    const optionInterceptors = resolveClasses<Interceptor>(
      container,
      container.graph.root,
      options.interceptors ?? [],
    );
    const optionFilters = resolveClasses<ExceptionFilter>(
      container,
      container.graph.root,
      options.filters ?? [],
    ).map((instance) =>
      Object.freeze({
        instance,
        exceptions: getCatchMetadata(instance.constructor as ClassToken<unknown>),
      }),
    );
    const globalGuards = Object.freeze([
      ...optionGuards,
      ...resolveGlobal<CanActivate>(container, APP_GUARD),
    ]);
    const globalInterceptors = Object.freeze([
      ...optionInterceptors,
      ...resolveGlobal<Interceptor>(container, APP_INTERCEPTOR),
    ]);
    const globalFilters = Object.freeze([
      ...optionFilters,
      ...resolveGlobal<ExceptionFilter>(container, APP_FILTER).map((instance) =>
        Object.freeze({
          instance,
          exceptions: getCatchMetadata(instance.constructor as ClassToken<unknown>),
        }),
      ),
    ]);
    const globalPipes = Object.freeze([
      ...(options.pipes ?? []).map((pipe) => resolveApplicationPipe(pipe, container)),
      ...resolveApplicationPipes(container),
    ]);

    const routes: MountedRoute[] = [];
    const versionRoutes: VersionNegotiationRoute[] = [];
    for (const module of container.graph.modules) {
      for (const definition of module.controllers) {
        if (definition.kind !== HttpControllerKind) {
          continue;
        }
        const token = definition.token as ClassToken<unknown>;
        const metadata = getControllerMetadata(token);
        if (metadata === undefined) {
          throw new AponiaError(
            "INVALID_CONTROLLER",
            `Class "${token.name}" is missing the @Controller() decorator.`,
            { controller: token.name },
          );
        }
        const compiled = compileRoutes(token, metadata.path);
        versionRoutes.push(...compiled);
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

    // One store object per application, shared by the middleware context and the
    // route context: a package that parks per-request state there must see the
    // same object in both phases, and `options.state` may be absent.
    const state = options.state ?? {};

    const kernelOptions = {
      routes,
      ...(logger === undefined ? {} : { logger }),
      store: state,
      ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
      ...(options.renderView === undefined ? {} : { renderView: options.renderView }),
      globalPipes,
    };

    const mountOptions = {
      store: state,
      prefix,
    };

    // Middleware mounts before routes: a runtime that composes middleware in
    // registration order must see it ahead of the handlers it wraps.
    const { consumer, getConfigs } = createMiddlewareConsumer();
    collectModuleMiddleware(container.graph.modules, container, consumer);
    if (host.mountMiddleware !== undefined) {
      const configs = getConfigs().map((config) =>
        Object.freeze({
          ...config,
          middleware: Object.freeze(
            config.middleware.map((entry) => resolveMiddlewareInstance(entry, container)),
          ),
        }),
      );
      host.mountMiddleware(configured, configs, mountOptions);
    }

    for (const mount of [...routes].sort(compareRouteSpecificity)) {
      const base = createRouteHandler(mount, kernelOptions);
      const handler =
        requestContext === undefined
          ? base
          : (context: PlatformRouteContext): Promise<Response> =>
              requestContext.run(
                context.request,
                (name, value) => {
                  context.set.headers[name] = value;
                },
                () => base(context),
              );
      host.mountRoute(configured, mount, handler, mountOptions);
    }

    // Probes mount beside the graph, after the routes they are checked
    // against, and carry no hook: an orchestrator polling readiness may not be
    // able to authenticate.
    const readiness = new ApplicationReadiness();
    for (const probe of compileHealthProbes(routes, options.health, readiness) ?? []) {
      host.mountRoute(configured, probe.mount, probe.handler, mountOptions);
    }

    const gatewayOptions: {
      maxPayloadLength?: number;
      idleTimeoutSeconds?: number;
      sendPings?: boolean;
    } = {};
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
        const dispatcher = createGatewayDispatcher(
          instance,
          plan,
          guards,
          resolveGatewayFilters(container, module, plan),
        );
        injectGatewayServer(
          instance,
          getWebSocketServerProperties(provider.useClass),
          dispatcher.server,
        );
        host.mountGateway(configured, plan, dispatcher);
        gatewayInits.push(() => dispatcher.afterInit());
        mergeGatewayOptions(gatewayOptions, plan);
      }
    }
    if (host.configureGatewayOptions !== undefined) {
      host.configureGatewayOptions(configured, gatewayOptions);
    }

    for (const call of collectLifecycleCalls(container, "onModuleInit")) {
      await call();
    }
    for (const afterInit of gatewayInits) {
      await afterInit();
    }

    const stop = async (force?: boolean): Promise<void> => {
      await listener.current?.close(force);
    };
    const shutdown = createShutdown(container, logger, stop);
    attachApplicationShutdown(configured as object, shutdown);

    for (const call of collectLifecycleCalls(container, "onApplicationBootstrap")) {
      await call();
    }

    const versionNegotiator = createVersionNegotiator(versionRoutes, options.versioning, prefix);
    const policies = resolveHttpPolicies({
      ...(options.cors === undefined ? {} : { cors: options.cors }),
      ...(options.securityHeaders === undefined
        ? {}
        : { securityHeaders: options.securityHeaders }),
      ...(options.etag === undefined ? {} : { etag: options.etag }),
      ...(options.compression === undefined ? {} : { compression: options.compression }),
    });
    const booted: BootedHttpApplication<TNative> = {
      native: configured,
      matcher: createRouteMatcher(routes),
      container,
      root: compiledRoot,
      shutdown,
      routes,
      listener,
      readiness,
      versionNegotiator,
      policies,
    };
    return new AponiaHttpApplication(host, booted, logger);
  }
}

function createRequestPipeline(
  negotiator: VersionNegotiator | undefined,
  policies: ResolvedHttpPolicies | undefined,
): RequestPipeline | undefined {
  if (negotiator === undefined && policies === undefined) {
    return undefined;
  }
  return async (request, next) => {
    const negotiated = negotiator?.(request);
    if (negotiated instanceof Response) {
      return negotiated;
    }
    const effective = negotiated ?? request;
    if (policies !== undefined) {
      const preflight = corsPreflight(effective, policies);
      if (preflight !== undefined) {
        return preflight;
      }
    }
    const response = await next(effective);
    return policies === undefined
      ? response
      : await applyHttpPolicies(effective, response, policies);
  };
}

function mergeGatewayOptions(
  target: {
    maxPayloadLength?: number;
    idleTimeoutSeconds?: number;
    sendPings?: boolean;
  },
  plan: {
    readonly maxPayloadLength?: number | undefined;
    readonly idleTimeoutMs?: number | undefined;
    readonly sendPings?: boolean | undefined;
  },
): void {
  if (plan.maxPayloadLength !== undefined) {
    target.maxPayloadLength =
      target.maxPayloadLength === undefined
        ? plan.maxPayloadLength
        : Math.min(target.maxPayloadLength, plan.maxPayloadLength);
  }
  if (plan.idleTimeoutMs !== undefined) {
    const seconds = Math.max(1, Math.ceil(plan.idleTimeoutMs / 1_000));
    target.idleTimeoutSeconds =
      target.idleTimeoutSeconds === undefined
        ? seconds
        : Math.min(target.idleTimeoutSeconds, seconds);
  }
  if (plan.sendPings === true) {
    target.sendPings = true;
  }
}

/** Orders mounts so a runtime whose router resolves first-match sees literals first. */
function compareRouteSpecificity(left: MountedRoute, right: MountedRoute): number {
  return routeSpecificity(right.route.path) - routeSpecificity(left.route.path);
}

function routeSpecificity(path: string): number {
  let specificity = 0;
  for (const segment of path.split("/").slice(1)) {
    if (segment === "*") {
      continue;
    }
    if (segment.startsWith(":")) {
      specificity += segment.endsWith("?") ? 1 : 2;
      continue;
    }
    specificity += 4;
  }
  return specificity;
}

/** Finds the request-context registration a module graph holds, if any. */
function locateRequestContext(container: AponiaContainer): RequestContextRegistration | undefined {
  try {
    const owner = container.graph.locate(container.graph.root, REQUEST_CONTEXT_REGISTRATION);
    return container.resolveModuleProvider(
      owner.module,
      REQUEST_CONTEXT_REGISTRATION,
    ) as RequestContextRegistration;
  } catch {
    for (const module of container.graph.modules) {
      try {
        container.graph.locate(module, REQUEST_CONTEXT_REGISTRATION);
        return container.resolveModuleProvider(
          module,
          REQUEST_CONTEXT_REGISTRATION,
        ) as RequestContextRegistration;
      } catch {
        // This module cannot reach the registration; keep looking.
      }
    }
    return undefined;
  }
}

/** Resolves the logger option into the service failures are reported through. */
function resolveLogger(option: AponiaHttpApplicationOptions["logger"]): LoggerService | undefined {
  if (option === false) {
    return undefined;
  }
  if (Array.isArray(option)) {
    return new Logger("AponiaFactory", { logLevels: option, timestamp: true });
  }
  return option as LoggerService | undefined;
}

/** Middleware runner reused by platform hosts. */
export { runMiddlewareChain };
export type { ResolvedMiddlewareConfig };
export type { PlatformRouteContext };
