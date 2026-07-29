import { AponiaError, type LoggerService } from "@aponiajs/common";
import { Elysia, type AnyElysia } from "elysia";

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
      this.#logger?.error(error, "AponiaApplication");
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

  async close(): Promise<void> {
    if (this.#nativeApplication.server) {
      await this.#nativeApplication.stop();
    }
  }
}
