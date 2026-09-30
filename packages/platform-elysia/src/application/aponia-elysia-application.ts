import { AponiaError, type LoggerService, type Token } from "@aponiajs/common";
import { Elysia, type AnyElysia } from "elysia";
import { reportThroughLogger } from "../errors/default-exception-filter.ts";
import type { AponiaListenOptions } from "./application.types.ts";
import { readApplicationToken } from "./application-container.ts";
import { readApplicationShutdown } from "./lifecycle-hooks.ts";
import { installShutdownSignalHandlers } from "./shutdown-signals.ts";

export class AponiaApplication<TNativeApplication extends AnyElysia = Elysia> {
  readonly #nativeApplication: TNativeApplication;
  readonly #logger: LoggerService | undefined;
  /**
   * Whether this application already owns the process's stop signals.
   *
   * A second `listen` must not install a second set: the installer's own
   * idempotence is per installation, so two of them would each run the teardown
   * once and the second would re-raise a signal the first had already answered.
   */
  #shutdownSignalsInstalled = false;

  constructor(nativeApplication: TNativeApplication, logger: LoggerService | undefined) {
    this.#nativeApplication = nativeApplication;
    this.#logger = logger;
  }

  getNativeApplication(): TNativeApplication {
    return this.#nativeApplication;
  }

  /**
   * The value a token resolves to, read from the container the boot built.
   *
   * Root visibility applies, exactly as it does for any other read from the root:
   * a token this application cannot reach raises `MISSING_PROVIDER`.
   */
  get<T>(token: Token<T>): T {
    return readApplicationToken(this.#nativeApplication, token);
  }

  handle(request: Request): Response | Promise<Response> {
    return this.#nativeApplication.handle(request);
  }

  /**
   * Binds the application to a port and starts serving.
   *
   * `options.shutdownSignals` is where this application takes over the process's
   * stop signals, and it is asked for at the end of a successful start: an
   * application whose boot failed keeps the process's signals, and one that
   * asked for none installs nothing.
   */
  async listen(port: number, options: AponiaListenOptions = {}): Promise<void> {
    try {
      this.#nativeApplication.listen(port);
      await this.#nativeApplication.modules;
      this.#logger?.log("Aponia application successfully started", "AponiaApplication");
      this.#logger?.log(`Application is running on: ${this.getUrl()}`, "AponiaApplication");

      if (options.shutdownSignals === true && !this.#shutdownSignalsInstalled) {
        this.#shutdownSignalsInstalled = true;
        // The bound method rather than a wrapper, so the teardown a signal runs
        // is stated as what it is: this application's own `close`, with the
        // documented default for `closeActiveConnections`. The signal path
        // exercises it in `tests/fixtures/shutdown-signal-app.ts`, in a process
        // whose own death is what the case reads.
        installShutdownSignalHandlers(this.close.bind(this), this.#logger);
      }
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

  async close(closeActiveConnections = true): Promise<void> {
    // A boot attaches the plan; an application no boot produced has none, and
    // keeps the behaviour this method had before the seam existed.
    const shutdown = readApplicationShutdown(this.#nativeApplication);
    if (shutdown) {
      await shutdown(closeActiveConnections);
      return;
    }

    if (this.#nativeApplication.server) {
      await this.#nativeApplication.stop(closeActiveConnections);
    }
  }
}
