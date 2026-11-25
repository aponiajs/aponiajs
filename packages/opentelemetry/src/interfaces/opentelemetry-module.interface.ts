import type { ConfigurationToken } from "@aponiajs/common";
import type { OpentelemetryRuntimeOptions } from "../tracing/opentelemetry.policy.ts";
import type { OpentelemetryConfiguration } from "./opentelemetry-tracing.interface.ts";

/**
 * How an application declares its tracing in its `imports`.
 *
 * The policy arrives through `configuration` rather than as an options object,
 * and that is the contract this package exists to add: a validated configuration
 * turns a missing service name, a wrong-typed body setting, or a request body
 * recorded beside a credential-bearing header into a refused boot with a code
 * and an issue list, where a loose object literal reaches the tracing hook and
 * is served as whatever the value happened to hold.
 *
 * The objects the tracing runtime also needs — the span processors, the
 * instrumentations, the context manager, the check predicate, and the rest of
 * the `NodeSDK` options — are properties of this type rather than fields of the
 * configuration, because they are code and live objects and a configuration
 * carries data only. They are the SDK's own settings, so a field the
 * configuration owns is removed from them: `serviceName`, `recordBody`,
 * `headersToSpanAttributes`, and `spanUrlRedaction` are set in exactly one place.
 */
export type OpentelemetryModuleOptions = Readonly<OpentelemetryRuntimeOptions> & {
  /**
   * The declaration whose value states the tracing policy.
   *
   * The module provides this token itself, from the environment unless `source`
   * says otherwise, and exports it, so the same validated value is both what the
   * tracing hook is built from and what the application can inject. It is a
   * `defineConfiguration` result rather than a schema, because the token is what
   * the container keys the value by and the schema alone has no identity a graph
   * could resolve.
   *
   * The value it validates carries data only — a service name, booleans, and
   * lists of header names and query parameter names. The `NodeSDK` also accepts
   * span processors, instrumentations, a context manager, and a request
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
   * A distinct key does not buy a second tracer. The SDK starts once per
   * process, for the first registration; a later registration's processors never
   * take effect, and its `serviceName` is never applied to a span. Two
   * registrations under distinct keys are two graph nodes and one started SDK.
   * One registration per process is the supported shape.
   */
  readonly key?: string;
  /**
   * The application-owned SDK handle, flushed and shut down when the
   * application closes. The registration constructs its `NodeSDK` itself and
   * keeps it to itself; an application that constructs and starts its own SDK
   * passes the handle here so `close()` can flush buffered spans.
   */
  readonly sdk?: {
    forceFlush?(): void | Promise<void>;
    shutdown?(): void | Promise<void>;
  };
};
