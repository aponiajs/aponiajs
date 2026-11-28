# @aponiajs/opentelemetry — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

Opt-in OpenTelemetry distributed tracing over `@opentelemetry/api`, W3C
`traceparent`/`tracestate` context extraction and injection, and automatic HTTP
server span lifecycle via `RequestLifecycleHook`. It is a leaf: nothing in the
framework depends on it.

| Domain                                                          | Owns                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `opentelemetry.module.ts`, `opentelemetry.module-definition.ts` | `OpenTelemetryModule.forRoot`/`forRootAsync`, `ConfigurableModuleBuilder` |
| `opentelemetry.constants.ts`                                    | The options token                                                         |
| `opentelemetry.service.ts`                                      | `OpenTelemetryService` wrapping `@opentelemetry/api` tracer/propagator    |
| `opentelemetry-lifecycle.provider.ts`                           | The `RequestLifecycleHook` managing HTTP server spans                     |
| `interfaces/`                                                   | Tracing and module option contracts                                       |

`src/index.ts` is the only public barrel.

## Invariants

- **Zero overhead when not registered.** Instrumentation runs only through
  `provideRequestLifecycleHooksAsync` when `OpenTelemetryModule` is imported.
- **SDK-agnostic.** Depends only on `@opentelemetry/api`; applications wire
  any OTel SDK/exporter globally via `trace.setGlobalTracerProvider` or `otel` options.
- **Configuration failures are `AponiaError` with `INVALID_OPENTELEMETRY_OPTIONS`.**

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+.
