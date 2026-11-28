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
  notifySystemLogger,
  provideClass,
  provideValue,
  type CanActivate,
  type ClassToken,
  type ExceptionFilter,
  type Interceptor,
  type LoggerService,
  type ModuleDefinition,
  type PipeType,
  type Token,
} from "@aponiajs/common";
import { createContainer, type AponiaContainer } from "@aponiajs/core";
import {
  APPLICATION_CONTAINER,
  attachApplicationContainer,
  createApplicationContainerRef,
} from "@aponiajs/core";
import { provideHttpAdapterHost } from "@aponiajs/common";
import type { PlatformHost, RequestPipeline } from "@aponiajs/common";
import type { HostRequestInfo, MountedRoute, PlatformRouteContext } from "@aponiajs/common";
import {
  compileStaticDispatchTable,
  createRouteHandler,
  type StaticDispatchTable,
} from "@aponiajs/core";
import { resolveApplicationPipe, resolveApplicationPipes, resolvePipe } from "@aponiajs/core";
import { compileRootModuleAsync, HttpControllerKind, isModuleDefinition } from "@aponiajs/common";
import type { AponiaRootModule } from "@aponiajs/common";
import { compileRoutes } from "@aponiajs/common";
import { createGatewayDispatcher, injectGatewayServer } from "@aponiajs/common";
import { compileGatewayPlan } from "@aponiajs/common";
import { joinPaths } from "@aponiajs/common";
import { normalizeRoutePrefix } from "@aponiajs/common";
import { createVersionNegotiator } from "@aponiajs/common";
import { normalizeStaticAssets } from "@aponiajs/common";
import {
  corsPreflight,
  resolveApplicationHttpPolicies,
  resolveHttpPolicies,
} from "@aponiajs/common";
import type { ResolvedHttpPolicies } from "@aponiajs/common";
import type { VersionNegotiationRoute, VersionNegotiator } from "@aponiajs/common";
import { createMiddlewareConsumer } from "@aponiajs/core";
import {
  collectModuleMiddleware,
  resolveMiddlewareInstance,
  runMiddlewareChain,
} from "@aponiajs/core";
import type { ResolvedMiddlewareConfig } from "@aponiajs/common";
import type {
  AponiaApplicationSurfaceConfig,
  AponiaHttpApplicationOptions,
  AponiaListenOptions,
} from "@aponiajs/common";
import { createApplicationSurfaceConfig, mergeApplicationSurfaceOptions } from "@aponiajs/common";
import {
  attachApplicationShutdown,
  collectLifecycleCalls,
  type ApplicationShutdown,
} from "@aponiajs/core";
import { installShutdownSignalHandlers } from "@aponiajs/common";
import { createShutdown } from "@aponiajs/core";
import { resolveClasses, resolveGatewayFilters, resolveGlobal } from "@aponiajs/core";
import { createRequestPipeline } from "@aponiajs/common";
import { compareRouteSpecificity } from "@aponiajs/common";
import { mergeGatewayOptions } from "@aponiajs/common";
import { locateRequestContext } from "@aponiajs/core";
import { applyPlatformModules, PLATFORM_ADAPTER_HOST } from "@aponiajs/common";
import { ApplicationReadiness, compileHealthProbes } from "@aponiajs/common";
import {
  BOOT_DIAGNOSTICS,
  createBootDiagnosticsRef,
  type AponiaRouteDiagnostics,
} from "@aponiajs/common";
import { assertPlatformCapabilities, providePlatformCapabilities } from "@aponiajs/common";
import { resolveRequestLifecycleHooks, type RequestLifecycleHook } from "@aponiajs/common";
import type { HttpPolicy } from "@aponiajs/common";

/** What one boot produced. */
export interface BootedHttpApplication<TNative = unknown> {
  /** The native application the host created. */
  readonly native: TNative;
  /** Tracks requests matched by a mounted route, probe, or static asset. */
  readonly matchedRequests: WeakSet<Request>;
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
  /** The neutral policies the graph's packages contributed. */
  readonly pluginPolicies?: readonly HttpPolicy[] | undefined;
  /** The neutral lifecycle hooks the graph's packages contributed. */
  readonly hooks?: readonly RequestLifecycleHook[] | undefined;
  /** Optional O(1) static route fast-dispatch table. */
  readonly staticDispatch?: StaticDispatchTable | undefined;
}

/** Where a listening application keeps the listener its shutdown plan stops. */
export interface ListenerRef {
  current?:
    | {
        readonly url: string;
        /** The runtime's server object, when the host states one. */
        readonly server?: unknown;
        close(force?: boolean): Promise<void>;
      }
    | undefined;
}

/**
 * What the shared wrapper needs to re-run the boot for a surface configuration
 * stated after `create`.
 *
 * The factory supplies it; an application no boot produced has none, and the
 * surface methods then refuse a configuration they cannot apply.
 *
 * @internal
 */
export interface AponiaHttpApplicationBoot<TNative = unknown> {
  readonly options: AponiaHttpApplicationOptions;
  readonly reboot: (
    options: AponiaHttpApplicationOptions,
  ) => Promise<AponiaHttpApplication<TNative>>;
}

/**
 * One managed application served by a host.
 *
 * `handle` answers without a port, `listen` binds one, and `close` runs the
 * shutdown plan whether or not anything ever listened. The Nest application
 * surface methods are here too: a boot mounts its routes during `create`, so a
 * surface method records its configuration and `init()` re-runs the boot once,
 * before the application serves anything. A boot with no surface configuration
 * is never re-run.
 */
export class AponiaHttpApplication<TNative = unknown> {
  #native: TNative;
  #host: PlatformHost<TNative, unknown>;
  #matchedRequests: WeakSet<Request>;
  #container: AponiaContainer;
  #shutdown: ApplicationShutdown;
  #listener: ListenerRef;
  #readiness: ApplicationReadiness;
  #logger: unknown;
  #versionNegotiator: VersionNegotiator | undefined;
  #policies: ResolvedHttpPolicies | undefined;
  #pipeline: RequestPipeline | undefined;
  #staticDispatch: StaticDispatchTable | undefined;
  #hostFetch:
    | ((
        application: TNative,
        request: Request,
        info?: HostRequestInfo,
      ) => Response | Promise<Response>)
    | undefined;
  readonly #boot: AponiaHttpApplicationBoot<TNative> | undefined;
  readonly #surface: AponiaApplicationSurfaceConfig = createApplicationSurfaceConfig();
  #applied = false;
  #closed = false;
  #signalsInstalled = false;
  #shutdownSignalsRequested = false;

  /** @internal */
  constructor(
    host: PlatformHost<TNative, unknown>,
    booted: BootedHttpApplication<TNative>,
    logger: unknown,
    boot?: AponiaHttpApplicationBoot<TNative>,
  ) {
    this.#host = host;
    this.#hostFetch = host.fetch?.bind(host);
    this.#native = booted.native;
    this.#matchedRequests = booted.matchedRequests;
    this.#container = booted.container;
    this.#shutdown = booted.shutdown;
    this.#listener = booted.listener;
    this.#readiness = booted.readiness;
    this.#logger = logger;
    this.#versionNegotiator = booted.versionNegotiator;
    this.#policies = booted.policies;
    this.#staticDispatch = booted.staticDispatch;
    this.#boot = boot;
    this.#pipeline = createRequestPipeline({
      negotiator: booted.versionNegotiator,
      policies: booted.policies,
      pluginPolicies: booted.pluginPolicies,
      hooks: booted.hooks,
    });
  }

  /** Answers one request through the platform's own router. */
  handle(request: Request, info?: HostRequestInfo): Response | Promise<Response> {
    if (this.#hostFetch === undefined) {
      throw new AponiaError(
        "UNSUPPORTED_PLATFORM_FEATURE",
        `The ${this.#host.name} platform does not answer raw requests.`,
        { feature: "handle", platform: this.#host.name },
      );
    }
    if (this.#pipeline === undefined) {
      if (this.#staticDispatch !== undefined && info === undefined) {
        const fast = this.#staticDispatch.dispatch(request);
        if (fast !== undefined) {
          return fast;
        }
      }
      return this.#hostFetch(this.#native, request, info);
    }
    return this.#pipeline(request, (current: Request) =>
      this.#hostFetch!(this.#native, current, info),
    );
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
    const response = await this.handle(
      effective,
      negotiated === undefined ? info : { ...info, path: pathname },
    );
    if (
      !this.#matchedRequests.has(effective) &&
      !this.#matchedRequests.has(request) &&
      response.status === 404
    ) {
      return undefined;
    }
    return response;
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
   * The runtime's server, once the application is listening.
   *
   * Elysia's wrapper returns the native Elysia server; the Bun-backed Hono and
   * H3 hosts return the `Bun.serve` object their listener bound.
   *
   * @returns The bound server, or `undefined` before `listen`.
   * @throws `UNSUPPORTED_PLATFORM_FEATURE` when a listening host states no server.
   */
  getHttpServer(): unknown {
    const listener = this.#listener.current;
    if (listener === undefined) {
      return undefined;
    }
    if (listener.server === undefined) {
      throw new AponiaError(
        "UNSUPPORTED_PLATFORM_FEATURE",
        `The ${this.#host.name} host does not state its server.`,
        { feature: "getHttpServer", platform: this.#host.name },
      );
    }
    return listener.server;
  }

  /**
   * Registers application-wide guards.
   *
   * They run before the guards a controller or handler declares, in the order
   * they were registered, and before the `APP_GUARD` declarations. The
   * configuration takes effect when `init()` runs; calling it after the
   * application serves traffic is refused, because a mounted route has already
   * compiled its guards.
   *
   * @param guards - The guard classes to resolve through the root module.
   * @returns This application.
   */
  useGlobalGuards(...guards: readonly ClassToken<unknown>[]): this {
    this.#assertConfigurable();
    this.#surface.guards.push(...guards);
    this.#surface.enabled = true;
    return this;
  }

  /** Registers application-wide interceptors, resolved the way guards are. */
  useGlobalInterceptors(...interceptors: readonly ClassToken<unknown>[]): this {
    this.#assertConfigurable();
    this.#surface.interceptors.push(...interceptors);
    this.#surface.enabled = true;
    return this;
  }

  /** Registers application-wide pipes, resolved the way guards are. */
  useGlobalPipes(...pipes: readonly PipeType[]): this {
    this.#assertConfigurable();
    this.#surface.pipes.push(...pipes);
    this.#surface.enabled = true;
    return this;
  }

  /** Registers application-wide exception filters, resolved the way guards are. */
  useGlobalFilters(...filters: readonly ClassToken<unknown>[]): this {
    this.#assertConfigurable();
    this.#surface.filters.push(...filters);
    this.#surface.enabled = true;
    return this;
  }

  /**
   * Declares the cross-origin policy.
   *
   * @param options - The policy, or nothing for the framework defaults.
   * @returns This application.
   */
  enableCors(options?: AponiaHttpApplicationOptions["cors"]): this {
    this.#assertConfigurable();
    this.#surface.cors = options ?? true;
    this.#surface.enabled = true;
    return this;
  }

  /**
   * Declares the security headers.
   *
   * Calling it twice refuses with `INVALID_CONFIGURATION`, as the Elysia
   * platform does: the second call would have to replace a policy the first
   * already compiled.
   *
   * @param options - The headers, or nothing for the framework defaults.
   * @returns This application.
   */
  useSecurityHeaders(options?: AponiaHttpApplicationOptions["securityHeaders"]): this {
    this.#assertConfigurable();
    if (this.#surface.securityHeaders !== undefined) {
      throw new AponiaError(
        "INVALID_CONFIGURATION",
        "useSecurityHeaders() may only be called once.",
        { option: "securityHeaders" },
      );
    }
    this.#surface.securityHeaders = options ?? true;
    this.#surface.enabled = true;
    return this;
  }

  /**
   * Mounts every compiled route under one path prefix.
   *
   * @param prefix - The prefix; it must begin with `/`.
   * @returns This application.
   */
  setGlobalPrefix(prefix: string): this {
    this.#assertConfigurable();
    this.#surface.prefix = prefix;
    this.#surface.enabled = true;
    return this;
  }

  /**
   * Installs header or media-type version negotiation.
   *
   * @param options - The strategy and the header or media-type parameter.
   * @returns This application.
   */
  enableVersioning(options: NonNullable<AponiaHttpApplicationOptions["versioning"]>): this {
    this.#assertConfigurable();
    this.#surface.versioning = options;
    this.#surface.enabled = true;
    return this;
  }

  /**
   * Takes over the process's stop signals.
   *
   * Equivalent to `listen(port, { shutdownSignals: true })`; a signal that
   * arrives after `listen` runs this application's `close`.
   *
   * @returns This application.
   */
  enableShutdownHooks(): this {
    this.#shutdownSignalsRequested = true;
    if (this.#listener.current !== undefined && !this.#signalsInstalled) {
      this.#installShutdownSignals();
    }
    return this;
  }

  /**
   * Replaces the system logger.
   *
   * @param logger - The logger every later report uses.
   * @returns This application.
   */
  useLogger(logger: LoggerService): this {
    this.#logger = logger;
    notifySystemLogger(logger);
    this.#surface.logger = logger;
    this.#surface.enabled = true;
    return this;
  }

  /**
   * Flushes buffered logs.
   *
   * Aponia's loggers write every line as it is logged, so there is no buffer to
   * flush; the method exists because a Nest application calls it.
   */
  flushLogs(): void {}

  /**
   * Applies a surface configuration stated after `create`.
   *
   * A boot with nothing configured returns this application unchanged. One with
   * a configuration re-runs the boot against the same root module and the merged
   * options, so the routes mount with the guards, pipes, prefix, and policies
   * the surface states.
   *
   * @returns This application, ready to serve.
   * @throws `INVALID_CONFIGURATION` when this application was not produced by a factory.
   */
  async init(): Promise<this> {
    if (this.#applied || !this.#surface.enabled) {
      return this;
    }
    if (this.#boot === undefined) {
      throw new AponiaError(
        "INVALID_CONFIGURATION",
        "This application was not produced by a platform factory, so it has no root module to reconfigure.",
        { option: "surface" },
      );
    }

    const rebound = await this.#boot.reboot(
      mergeApplicationSurfaceOptions(this.#boot.options, this.#surface),
    );
    this.#adopt(rebound);
    this.#applied = true;
    return this;
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
        { feature: "listen", platform: this.#host.name },
      );
    }
    this.#listener.current = await this.#host.listen(
      this.#native,
      port,
      this.#pipeline,
      this.#staticDispatch?.bunRoutes,
    );
    if (
      (options.shutdownSignals === true || this.#shutdownSignalsRequested) &&
      !this.#signalsInstalled
    ) {
      this.#installShutdownSignals();
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

  /** Refuses a route-affecting configuration once the application serves. */
  #assertConfigurable(): void {
    if (this.#applied) {
      throw new AponiaError(
        "INVALID_CONFIGURATION",
        "A surface method cannot change routes the application already mounted. Call it before init().",
        { option: "surface" },
      );
    }
  }

  #installShutdownSignals(): void {
    this.#signalsInstalled = true;
    installShutdownSignalHandlers((signal) => this.close(true, signal), this.#logger as never);
  }

  /**
   * Takes over the state a re-run boot produced.
   *
   * A surface configuration re-runs the whole boot, so the wrapper must speak
   * through the new native application, matcher, container, and shutdown plan;
   * keeping any of the old ones would answer requests from a graph the surface
   * never configured. The new application has not listened, so the stop-signal
   * installation starts over.
   */
  #adopt(next: AponiaHttpApplication<TNative>): void {
    this.#host = next.#host;
    this.#native = next.#native;
    this.#matchedRequests = next.#matchedRequests;
    this.#container = next.#container;
    this.#shutdown = next.#shutdown;
    this.#listener = next.#listener;
    this.#readiness = next.#readiness;
    this.#logger = next.#logger;
    this.#versionNegotiator = next.#versionNegotiator;
    this.#policies = next.#policies;
    this.#pipeline = next.#pipeline;
    this.#staticDispatch = next.#staticDispatch;
    this.#hostFetch = next.#hostFetch;
    this.#closed = false;
    this.#signalsInstalled = false;
  }
}

/** The boot options the unified factory takes when the adapter is a field. */
/**
 * Resolves the logger option into the service failures are reported through.
 */
function resolveLogger(option: AponiaHttpApplicationOptions["logger"]): LoggerService | undefined {
  if (option === false) {
    return undefined;
  }
  if (Array.isArray(option)) {
    return new Logger("AponiaFactory", { logLevels: option, timestamp: true });
  }
  return option as LoggerService | undefined;
}

export function createBootstrapFactory<TNative>(host: PlatformHost<TNative, unknown>) {
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
    const matchedRequests = new WeakSet<Request>();
    const compiledRoot = await compileRootModuleAsync(rootModule);
    // Created before the container so the running platform is injectable from
    // the first provider that resolves.
    const native = host.createApplication(compiledRoot.id);
    const configured =
      options.configureNative === undefined
        ? native
        : (options.configureNative(native as never) as TNative);
    const containerRef = createApplicationContainerRef();
    const diagnosticsRef = createBootDiagnosticsRef();
    const container = createContainer(compiledRoot, [
      provideValue(APPLICATION_CONTAINER, containerRef),
      provideValue(BOOT_DIAGNOSTICS, diagnosticsRef),
      provideValue(LOGGER, logger ?? NOOP_LOGGER),
      provideValue(
        PLATFORM_ADAPTER_HOST,
        Object.freeze({ platform: host.name, nativeApplication: configured }),
      ),
      provideClass(Reflector, []),
      provideHttpAdapterHost(),
      ...(host.capabilities === undefined
        ? []
        : [
            providePlatformCapabilities({
              platform: host.name,
              capabilities: host.capabilities,
            }),
          ]),
    ]);
    containerRef.current = container;
    attachApplicationContainer(configured as object, container);
    // Refused before anything mounts: a registration that needs a capability
    // this platform does not have must not leave a half-mounted application.
    assertPlatformCapabilities(container);
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
      await container.initializeModuleAsync(module);
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
    const diagnosticRoutes: AponiaRouteDiagnostics[] = [];
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
          diagnosticRoutes.push(
            Object.freeze({
              module: module.id,
              controller: token.name,
              route,
              source: "compiled" as const,
            }),
          );
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
    const requestHooks = resolveRequestLifecycleHooks(container);

    const kernelOptions = {
      routes,
      ...(logger === undefined ? {} : { logger }),
      store: state,
      ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
      ...(options.renderView === undefined ? {} : { renderView: options.renderView }),
      globalPipes,
      requestHooks,
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
                () => Promise.resolve(base(context)),
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
    const policies = resolveApplicationHttpPolicies({
      ...(options.cors === undefined ? {} : { cors: options.cors }),
      ...(options.securityHeaders === undefined
        ? {}
        : { securityHeaders: options.securityHeaders }),
      ...(options.etag === undefined ? {} : { etag: options.etag }),
      ...(options.compression === undefined ? {} : { compression: options.compression }),
    });
    const pluginPolicies = resolveHttpPolicies(container);
    const staticDispatch = compileStaticDispatchTable(routes, {
      enabled: options.fastDispatch,
      hasMiddleware: getConfigs().length > 0 || options.middleware !== undefined,
      hasHttpPolicies: policies !== undefined || pluginPolicies.length > 0,
      hasRequestHooks: requestHooks.length > 0,
      hasVersioning: versionNegotiator !== undefined,
      hasRequestContext: requestContext !== undefined,
      hasStaticAssets: options.staticAssets !== undefined,
      globalPipesCount: globalPipes.length,
      logger: logger as LoggerService | undefined,
    });
    diagnosticsRef.current = Object.freeze({
      framework: null,
      graph: isModuleDefinition(rootModule) ? "declared" : "decorated",
      rootModule: compiledRoot,
      modules: container.graph.modules,
      routes: Object.freeze(diagnosticRoutes),
      callbackRoutes: Object.freeze([]),
      globalEnhancers: collectDeclaredEnhancers(container),
      interceptorHalves: new Map(),
      artifacts: null,
      invokers: null,
      mappedExceptions: null,
    });
    const booted: BootedHttpApplication<TNative> = {
      native: configured,
      matchedRequests,
      container,
      root: compiledRoot,
      shutdown,
      routes,
      listener,
      readiness,
      versionNegotiator,
      policies,
      pluginPolicies,
      hooks: requestHooks,
      staticDispatch,
    };
    return new AponiaHttpApplication(host, booted, logger, {
      options,
      reboot: (rebootOptions) => boot(rootModule, rebootOptions),
    });
  }
}

/** The class tokens a module declared under the four application-enhancer tokens. */
function collectDeclaredEnhancers(container: AponiaContainer): {
  readonly guards: readonly ClassToken<unknown>[];
  readonly interceptors: readonly ClassToken<unknown>[];
  readonly filters: readonly ClassToken<unknown>[];
} {
  const guards: ClassToken<unknown>[] = [];
  const interceptors: ClassToken<unknown>[] = [];
  const filters: ClassToken<unknown>[] = [];
  for (const module of container.graph.modules) {
    for (const provider of module.providers) {
      if (provider.kind !== "class") {
        continue;
      }
      if (provider.provide === APP_GUARD) {
        guards.push(provider.useClass);
      } else if (provider.provide === APP_INTERCEPTOR) {
        interceptors.push(provider.useClass);
      } else if (provider.provide === APP_FILTER) {
        filters.push(provider.useClass);
      }
    }
  }
  return Object.freeze({
    guards: Object.freeze(guards),
    interceptors: Object.freeze(interceptors),
    filters: Object.freeze(filters),
  });
}

/** Middleware runner reused by platform hosts. */
export { runMiddlewareChain };
export type { ResolvedMiddlewareConfig };
export type { PlatformRouteContext };
