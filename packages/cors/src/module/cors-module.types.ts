import type { ConfigurationToken } from "@aponiajs/common";
import type { CorsConfiguration } from "../policy/cors-policy.types.ts";

/**
 * How an application declares its cross-origin policy in its `imports`.
 *
 * The policy arrives through `configuration` rather than as an options object,
 * and that is the contract this package exists to add: a validated
 * configuration turns a missing origin, a malformed list, or a
 * wildcard-with-credentials pair into a refused boot with a code and an issue
 * list, where a loose object literal reaches the plugin and is served as
 * whatever the value happened to hold.
 */
export interface CorsModuleOptions {
  /**
   * The declaration whose value states the cross-origin policy.
   *
   * The module provides this token itself, from the environment unless `source`
   * says otherwise, and exports it, so the same validated value is both what
   * the plugin is configured from and what the application can inject. It is a
   * `defineConfiguration` result rather than a schema, because the token is
   * what the container keys the value by and the schema alone has no identity a
   * graph could resolve.
   *
   * The value it validates carries data only — origin strings, method and
   * header names, booleans, and a number. The wrapped plugin also accepts a
   * `RegExp` or a `(request) => boolean` function as its `origin`, and neither
   * is a value a configuration can carry; the README names that boundary and
   * the raw plugin as the path for a reader who needs one.
   */
  readonly configuration: ConfigurationToken<CorsConfiguration>;
  /**
   * The record the configuration's schema validates, instead of `process.env`.
   *
   * Present for the same reason `provideConfiguration` accepts it: a literal is
   * how a test — or an application reading a file rather than its environment —
   * validates without mutating the process. Omitting it reads the environment,
   * which is what an application in production wants and what a test must not
   * get.
   */
  readonly source?: Readonly<Record<string, unknown>>;
  /**
   * The module's stable identity, which is what the graph keys the registration
   * by.
   *
   * Two registrations under one key are one module identity, which the graph
   * refuses as a duplicate rather than mounting one and dropping the other.
   * Defaults to `"cors"`.
   *
   * A distinct key does not buy a second policy. The wrapped plugin names
   * itself, and Elysia mounts a named plugin whose identity matches one already
   * mounted only once, so two registrations that resolve to the same policy
   * share the one plugin; two that resolve to different policies both mount,
   * and the request sees both. One registration per application is the
   * supported shape.
   */
  readonly key?: string;
}
