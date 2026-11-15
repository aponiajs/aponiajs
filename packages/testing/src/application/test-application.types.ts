import type { AponiaApplicationOptions } from "@aponiajs/platform-elysia";

/**
 * What a test application is built with.
 *
 * It is the factory's own option contract rather than a narrower copy, so every
 * option a boot takes stays reachable from a test: `plugins`, `health`, the
 * global enhancers, and a `LoggerService` a case wants to assert on. The one
 * difference is the default — `logger` is `false` unless a case asks for
 * something else, because startup output in a test report is noise a case rarely
 * wants and never needs.
 *
 * `configureNative` is deliberately not among them, and a test that needs it
 * calls `AponiaFactory.create` instead. On the factory it is the option that
 * preserves the native application's own type so Eden Treaty can read it, and
 * `TestApplication` erases the native application to `AnyElysia` on purpose —
 * accepting the option here would accept a type argument this wrapper discards,
 * which is worse than not accepting it. A case that only wants to read the
 * native application after boot still reaches it through `application`.
 */
export type TestApplicationOptions = AponiaApplicationOptions;

/**
 * A real listener a gateway test opened.
 *
 * Both URLs name the same bound socket. `url` is what a request would be sent
 * to, and `webSocketUrl` is the `ws://` form of it, which is the string a
 * `WebSocket` is constructed from.
 */
export interface TestServer {
  readonly url: string;
  readonly webSocketUrl: string;
}
