import { AponiaError, type LoggerService } from "@aponiajs/common";
import { Elysia, type AnyElysia } from "elysia";
import { reportThroughLogger } from "../errors/default-exception-filter.ts";

export class AponiaElysiaApplication<TNativeApplication extends AnyElysia = Elysia> {
  readonly #nativeApplication: TNativeApplication;
  readonly #logger: LoggerService | undefined;

  constructor(nativeApplication: TNativeApplication, logger: LoggerService | undefined) {
    this.#nativeApplication = nativeApplication;
    this.#logger = logger;
  }

  getNativeApplication(): TNativeApplication {
    return this.#nativeApplication;
  }

  handle(request: Request): Response | Promise<Response> {
    return this.#nativeApplication.handle(request);
  }

  async listen(port: number): Promise<void> {
    try {
      this.#nativeApplication.listen(port);
      await this.#nativeApplication.modules;
      this.#logger?.log("Aponia application successfully started", "AponiaApplication");
      this.#logger?.log(`Application is running on: ${this.getUrl()}`, "AponiaApplication");
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
    if (this.#nativeApplication.server) {
      await this.#nativeApplication.stop(closeActiveConnections);
    }
  }
}
