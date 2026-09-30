import type { Token } from "@aponiajs/common";
import type { AnyElysia } from "elysia";
import type { AponiaApplication } from "@aponiajs/platform-elysia";
import type { TestServer } from "./test-application.types.ts";

/**
 * One booted application, with the teardown a test can rely on.
 *
 * It holds the application the factory returned rather than reimplementing it:
 * `application` is that object, and `handle`, `get`, and `listen` reach it
 * unchanged. What this wrapper adds is a stop that can run twice and a
 * `Symbol.asyncDispose`, so a case can close a boot without tracking whether it
 * already did, and a case that opened a listener cannot outlive its own scope.
 */
export class TestApplication {
  readonly #application: AponiaApplication<AnyElysia>;
  #closed = false;

  constructor(application: AponiaApplication<AnyElysia>) {
    this.#application = application;
  }

  /** The booted application, for anything this wrapper does not forward. */
  get application(): AponiaApplication<AnyElysia> {
    return this.#application;
  }

  /** Reads a token back from this boot, with the application's own visibility rules. */
  get<T>(token: Token<T>): T {
    return this.#application.get(token);
  }

  /**
   * Answers a request through the real module graph, the real container, and the
   * real routes, without binding a port. This is the headline path: nothing here
   * has to be closed, and a case that only calls it never opens a socket.
   */
  handle(request: Request): Response | Promise<Response> {
    return this.#application.handle(request);
  }

  /**
   * Binds a real port, which is what a WebSocket upgrade needs and the one thing
   * an ephemeral port cannot avoid.
   *
   * Port `0` asks the operating system for a free port and `getUrl()` reports the
   * one it granted, so nothing here reserves and releases a port first — the
   * reservation would leave a window in which another process could take it.
   */
  async listen(): Promise<TestServer> {
    await this.#application.listen(0);
    const url = this.#application.getUrl();
    return Object.freeze({ url, webSocketUrl: url.replace(/^http/, "ws") });
  }

  /** Stops the application and runs its stopping hooks. Idempotent. */
  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#application.close();
  }

  /** What `await using` calls, so a boot cannot outlive the scope that made it. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
