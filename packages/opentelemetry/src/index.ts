/**
 * `@aponiajs/opentelemetry` — trace an application's routes with OpenTelemetry.
 *
 * The package wraps
 * [`@elysia/opentelemetry`](https://www.npmjs.com/package/@elysia/opentelemetry).
 * **It is not a tracing backend and it ships no exporter.** The root span, the
 * per-stage spans, the span attributes, the propagation, and the SDK startup are
 * the plugin's own; what this package contributes is a module the registration
 * belongs in and a validated configuration the policy is read from. The span
 * processors, the exporters, and the instrumentations are the application's, and
 * an application that would rather wire them to the raw plugin should install
 * `@elysia/opentelemetry` directly.
 */
export { OpentelemetryModule } from "./module/opentelemetry-module.ts";
export type { OpentelemetryModuleOptions } from "./module/opentelemetry-module.types.ts";
export type { OpentelemetryConfiguration } from "./tracing/opentelemetry-tracing.types.ts";
