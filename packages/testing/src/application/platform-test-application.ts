import type { Token } from "@aponiajs/common";
import type { TestableApplication } from "../interfaces/platform-test-application.interface.ts";

/**
 * A boot from any platform, with the teardown a test can rely on.
 *
 * The Elysia-oriented `TestApplication` also owns the override builder and a
 * listen helper; this wrapper owns only what every platform shares — `handle`,
 * `get`, a `close()` that can run twice, and `Symbol.asyncDispose` — so a test of
 * a Hono, H3, or Nitro application gets the same teardown guarantee without the
 * Elysia surface.
 *
 * @example
 * ```ts
 * const application = wrapPlatformApplication(
 *   await AponiaFactory.create(AppModule, { logger: false }),
 * );
 * await application.handle(new Request("http://localhost/"));
 * await application.close();
 * ```
 */
export class PlatformTestApplication<TApplication extends TestableApplication> {
  readonly #application: TApplication;
  #closed = false;

  constructor(application: TApplication) {
    this.#application = application;
  }

  /** The booted application, for anything this wrapper does not forward. */
  get application(): TApplication {
    return this.#application;
  }

  /** Answers one request through the real graph and kernel. */
  handle(request: Request): Response | Promise<Response> {
    return this.#application.handle(request);
  }

  /**
   * Reads a token back from this boot.
   *
   * @param token - The token to resolve.
   * @returns The cached singleton instance.
   */
  get<T>(token: Token<T>): T {
    return this.#application.get(token);
  }

  /** Runs the shutdown plan once, however many times it is called. */
  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#application.close();
  }

  /** `await using` closes the boot at the end of its scope. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

/**
 * Wraps any platform's booted application in the shared teardown contract.
 *
 * @param application - The application `AponiaFactory.create` returned.
 * @returns The wrapper.
 */
export function wrapPlatformApplication<TApplication extends TestableApplication>(
  application: TApplication,
): PlatformTestApplication<TApplication> {
  return new PlatformTestApplication(application);
}
