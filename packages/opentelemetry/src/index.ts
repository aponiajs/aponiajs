/**
 * `@aponiajs/opentelemetry` — trace an application's routes with OpenTelemetry.
 *
 * **It is not a tracing backend and it ships no exporter.** Tracing is a
 * neutral `RequestLifecycleHook`: one server span per request, active for the
 * handler, the guards, and every service they call, on every platform. What
 * this package contributes is a module the registration belongs in and a
 * validated configuration the policy is read from. The span processors, the
 * exporters, and the instrumentations are the application's.
 */
export { OpentelemetryModule } from "./module/opentelemetry.module.ts";
export type { OpentelemetryModuleOptions } from "./interfaces/opentelemetry-module.interface.ts";
export type { OpentelemetryConfiguration } from "./interfaces/opentelemetry-tracing.interface.ts";
export type { OpentelemetryPolicy } from "./tracing/opentelemetry.policy.ts";
