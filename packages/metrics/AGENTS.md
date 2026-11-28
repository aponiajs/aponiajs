# @aponiajs/metrics — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

Zero-dependency Prometheus text format (`0.0.4`) metrics exposition, custom
counters/gauges/histograms, runtime gauges, and opt-in HTTP request latency and
status-code tracking via `RequestLifecycleHook`. It is a leaf: nothing in the
framework depends on it.

| Domain                                              | Owns                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `metrics.module.ts`, `metrics.module-definition.ts` | `MetricsModule.forRoot`/`forRootAsync`, `ConfigurableModuleBuilder`         |
| `metrics.constants.ts`                              | The options and resolved-options injection tokens                           |
| `metrics.service.ts`                                | `MetricsService` registry, Prometheus text serializer, HTTP/runtime metrics |
| `metrics-lifecycle.provider.ts`                     | The `RequestLifecycleHook` serving `/metrics` and observing requests        |
| `interfaces/`                                       | Metric and module option contracts                                          |

`src/index.ts` is the only public barrel.

## Invariants

- **Zero overhead when not registered.** Instrumentation runs only through
  `provideRequestLifecycleHooksAsync` when `MetricsModule` is imported.
- **Bounded label cardinality.** Each metric enforces `maxLabelCombinations`
  (default `2000`) to prevent unbounded memory growth from high-cardinality labels.
- **Route normalization.** HTTP metrics normalize query strings away and use
  the URL pathname so query parameters never explode metric cardinality.
- **Configuration failures are `AponiaError` with `INVALID_METRICS_OPTIONS`.**

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+.
