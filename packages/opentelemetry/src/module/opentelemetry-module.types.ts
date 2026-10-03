import type { ConfigurationToken } from "@aponiajs/common";
import type { OpentelemetryRuntimeOptions } from "../tracing/opentelemetry-tracing.ts";
import type { OpentelemetryConfiguration } from "../tracing/opentelemetry-tracing.types.ts";

/**
 * How an application declares its tracing in its `imports`.
 *
 * The policy arrives through `configuration` rather than as an options object,
 * and that is the contract this package exists to add: a validated configuration
 * turns a missing service name, a wrong-typed body setting, or a request body
 * recorded beside a credential-bearing header into a refused boot with a code
 * and an issue list, where a loose object literal reaches the plugin and is
 * served as whatever the value happened to hold.
 *
 * The objects the plugin also needs — the span processors, the instrumentations,
 * the context manager, the check predicate, and the rest of the `NodeSDK`
 * options — are properties of this type rather than fields of the configuration,
 * because they are code and live objects and a configuration carries data only.
 * They are derived from the wrapped plugin's own options type, so a field the
 * configuration owns is removed from them: `serviceName`, `recordBody`,
 * `headersToSpanAttributes`, and `spanUrlRedaction` are set in exactly one place.
 */
export type OpentelemetryModuleOptions = Readonly<OpentelemetryRuntimeOptions> & {
  /**
   * The declaration whose value states the tracing policy.
   *
   * The module provides this token itself, from the environment unless `source`
   * says otherwise, and exports it, so the same validated value is both what the
   * plugin is configured from and what the application can inject. It is a
   * `defineConfiguration` result rather than a schema, because the token is what
   * the container keys the value by and the schema alone has no identity a graph
   * could resolve.
   *
   * The value it validates carries data only — a service name, booleans, and
   * lists of header names and query parameter names. The wrapped plugin also
   * accepts span processors, instrumentations, a context manager, and a request
   * predicate, and none of those is a value a configuration can carry; they are
   * properties of these options, and the README names the boundary.
   */
  readonly configuration: ConfigurationToken<OpentelemetryConfiguration>;
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
   * Defaults to `"opentelemetry"`.
   *
   * A distinct key does not buy a second tracer. The wrapped plugin names itself
   * and declares no seed, so Elysia mounts it once however many registrations
   * exist, and the plugin's `NodeSDK` starts only for the first registration in a
   * process. Two registrations under distinct keys are two graph nodes and one
   * mount, and the second one's `serviceName` and span processors are never
   * applied. One registration per process is the supported shape.
   */
  readonly key?: string;
};
