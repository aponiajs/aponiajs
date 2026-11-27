import {
  AponiaError,
  notifySystemLogger,
  type LoggerService,
  type ClassToken,
  type PipeType,
  type Token,
} from "@aponiajs/common";
import { Elysia, type AnyElysia } from "elysia";
import { reportThroughLogger } from "../exceptions/default-exception.filter.ts";
import type {
  AponiaListenOptions,
  AponiaApplicationOptions,
} from "../interfaces/application.interface.ts";
import { readApplicationToken } from "./application-container.ts";
import {
  createApplicationSurfaceConfig,
  mergeApplicationSurfaceOptions,
  type AponiaApplicationSurfaceConfig,
} from "@aponiajs/common";
import { readApplicationShutdown } from "@aponiajs/core";
import { installShutdownSignalHandlers } from "./shutdown-signals.ts";

/**
 * Re-runs the boot for a surface configuration stated after `create`.
 *
 * The factory supplies it; an application no boot produced has none, and the
 * surface methods then refuse a configuration they cannot apply.
 *
 * @internal
 */
export type ApplicationReboot = (options: AponiaApplicationOptions) => Promise<{
  readonly nativeApplication: AnyElysia;
  readonly logger: LoggerService | undefined;
  readonly releaseRequest?: (request: Request) => void;
}>;

/** What the wrapper needs from the factory to rebuild itself after `create`. */
export interface AponiaApplicationBoot {
  readonly rootModule: unknown;
  readonly options: AponiaApplicationOptions;
  readonly reboot: ApplicationReboot;
}

/**
 * The managed lifecycle facade every booted application is wrapped in.
 *
 * `handle` answers without a port, `listen` binds one, `get` reads the
 * container the boot built, and `close` runs the shutdown plan whether or
 * not anything ever listened.
 *
 * The Nest application surface methods (`useGlobal*`, `enableCors`,
 * `setGlobalPrefix`, `enableVersioning`, `enableShutdownHooks`) are available
 * here. Aponia boots during `create`, so a surface method records its
 * configuration and `init()` re-runs the route mount once, before the
 * application serves anything; a boot with no surface configuration is never
 * re-run.
 */
export class AponiaApplication<TNativeApplication extends AnyElysia = Elysia> {
  #nativeApplication: TNativeApplication;
  #logger: LoggerService | undefined;
  #releaseRequest: ((request: Request) => void) | undefined;
  readonly #boot: AponiaApplicationBoot | undefined;
  readonly #surface: AponiaApplicationSurfaceConfig = createApplicationSurfaceConfig();
  #applied = false;
  /**
   * Whether this application already owns the process's stop signals.
   *
   * A second `listen` must not install a second set: the installer's own
   * idempotence is per installation, so two of them would each run the teardown
   * once and the second would re-raise a signal the first had already answered.
   */
  #shutdownSignalsInstalled = false;
  #shutdownSignalsRequested = false;

  constructor(
    nativeApplication: TNativeApplication,
    logger: LoggerService | undefined,
    releaseRequest?: (request: Request) => void,
    boot?: AponiaApplicationBoot,
  ) {
    this.#nativeApplication = nativeApplication;
    this.#logger = logger;
    this.#releaseRequest = releaseRequest;
    this.#boot = boot;
  }

  /**
   * The native Elysia application the boot composed.
   *
   * @returns The composed instance, for native tooling such as Eden Treaty.
   */
  getNativeApplication(): TNativeApplication;
  getNativeApplication<TApp extends AnyElysia>(): TApp;
  getNativeApplication(): AnyElysia {
    return this.#nativeApplication;
  }

  /** The runtime's own application object; `getNativeApplication()` by another name. */
  getHttpAdapter(): AnyElysia {
    return this.#nativeApplication;
  }

  /**
   * The runtime's underlying server, once the application is listening.
   *
   * Nest returns its Node `http.Server` here. Elysia owns a Bun server, so the
   * value is that server and it is absent until `listen`.
   *
   * @returns The bound server, or `undefined` before `listen`.
   */
  getHttpServer(): unknown {
    return this.#nativeApplication.server;
  }

  /**
   * The value a token resolves to, read from the container the boot built.
   *
   * Root visibility applies, exactly as it does for any other read from the root:
   * a token this application cannot reach raises `MISSING_PROVIDER`, and an
   * `APP_*` pseudo-provider is refused rather than answered with one enhancer.
   *
   * @param token - The token to resolve.
   * @returns The cached singleton instance.
   * @throws An `AponiaError` with `MISSING_PROVIDER` or `AMBIGUOUS_PROVIDER`.
   *
   * @example
   * ```ts
   * const greeting = application.get(GREETING);
   * ```
   */
  get<T>(token: Token<T>): T {
    return readApplicationToken(this.#nativeApplication, token);
  }

  /**
   * Registers application-wide guards.
   *
   * They run before the guards a controller or handler declares, in the order
   * they were registered, and before the `APP_GUARD` declarations. The
   * configuration takes effect when `init()` runs; calling it after the
   * application serves traffic is refused, because a mounted route has already
   * compiled its hook.
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
  enableCors(options?: AponiaApplicationOptions["cors"]): this {
    this.#assertConfigurable();
    this.#surface.cors = options ?? true;
    this.#surface.enabled = true;
    return this;
  }

  /**
   * Declares the security headers.
   *
   * Calling it twice refuses with `INVALID_CONFIGURATION`, as Nest's
   * `useSecurityHeaders` does: the second call would have to replace a policy
   * the first already compiled.
   *
   * @param options - The headers, or nothing for the framework defaults.
   * @returns This application.
   */
  useSecurityHeaders(options?: AponiaApplicationOptions["securityHeaders"]): this {
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
  enableVersioning(options: NonNullable<AponiaApplicationOptions["versioning"]>): this {
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
    if (this.#nativeApplication.server && !this.#shutdownSignalsInstalled) {
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
   * Aponia's `ConsoleLogger` writes every line as it is logged, so there is no
   * buffer to flush; the method exists because a Nest application calls it.
   */
  flushLogs(): void {}

  /**
   * Applies a surface configuration stated after `create`.
   *
   * A boot with nothing configured returns this application unchanged. One with
   * a configuration re-runs the boot against the same root module and the merged
   * options, so the routes mount with the guards, pipes, prefix, and versioning
   * the surface states.
   *
   * @returns This application, ready to serve.
   */
  async init(): Promise<this> {
    if (this.#applied || !this.#surface.enabled) {
      return this;
    }
    if (this.#boot === undefined) {
      throw new AponiaError(
        "INVALID_CONFIGURATION",
        "This application was not produced by AponiaFactory.create, so it has no root module to reconfigure.",
        { option: "surface" },
      );
    }

    const rebound = await this.#boot.reboot(
      mergeApplicationSurfaceOptions(this.#boot.options, this.#surface),
    );
    this.#nativeApplication = rebound.nativeApplication as TNativeApplication;
    this.#logger = rebound.logger;
    this.#releaseRequest = rebound.releaseRequest;
    this.#applied = true;
    // A new native instance means the stop signals belong to the old one.
    this.#shutdownSignalsInstalled = false;
    return this;
  }

  /**
   * Answers a request against the composed route table, without a port.
   *
   * @param request - The request to answer.
   * @returns The response the routes produced.
   *
   * @example
   * ```ts
   * const response = await application.handle(new Request("http://localhost/users"));
   * ```
   */
  handle(request: Request): Response | Promise<Response> {
    const result = this.#nativeApplication.handle(request);
    if (typeof (result as Promise<Response>).then === "function") {
      return (result as Promise<Response>).finally(() => this.#releaseRequest?.(request));
    }
    this.#releaseRequest?.(request);
    return result;
  }

  /**
   * Binds the application to a port and starts serving.
   *
   * `options.shutdownSignals` is where this application takes over the process's
   * stop signals, and it is asked for at the end of a successful start: an
   * application whose boot failed keeps the process's signals, and one that
   * asked for none installs nothing.
   *
   * @param port - The port to listen on.
   * @param options - The opt-in stop-signal takeover.
   * @throws Whatever the engine's listen throws, reported through the logger first.
   *
   * @example
   * ```ts
   * await application.listen(3000);
   * ```
   */
  async listen(port: number, options: AponiaListenOptions = {}): Promise<this> {
    try {
      this.#nativeApplication.listen(port);
      await this.#nativeApplication.modules;
      this.#logger?.log("Aponia application successfully started", "AponiaApplication");
      this.#logger?.log(`Application is running on: ${this.getUrl()}`, "AponiaApplication");

      if (
        (options.shutdownSignals === true || this.#shutdownSignalsRequested) &&
        !this.#shutdownSignalsInstalled
      ) {
        this.#installShutdownSignals();
      }
      return this;
    } catch (error) {
      // Reported rather than the reason the caller hears: `reportThroughLogger`
      // guards the logger, so the failure thrown below is still the engine's.
      reportThroughLogger(this.#logger, error, "AponiaApplication");
      throw error;
    }
  }

  getUrl(): string {
    const server = this.#nativeApplication.server;
    if (!server) {
      throw new AponiaError(
        "APPLICATION_NOT_LISTENING",
        "app.listen() needs to be called before calling app.getUrl().",
      );
    }

    return server.url.origin;
  }

  async close(closeActiveConnections = true, signal?: string): Promise<void> {
    // A boot attaches the plan; an application no boot produced has none, and
    // keeps the behaviour this method had before the seam existed.
    const shutdown = readApplicationShutdown(this.#nativeApplication);
    if (shutdown) {
      await shutdown(closeActiveConnections, signal);
      return;
    }

    if (this.#nativeApplication.server) {
      await this.#nativeApplication.stop(closeActiveConnections);
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
    this.#shutdownSignalsInstalled = true;
    installShutdownSignalHandlers((signal) => this.close(true, signal), this.#logger);
  }
}
