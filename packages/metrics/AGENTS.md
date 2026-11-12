# @aponiajs/metrics — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The Prometheus registry, the scrape endpoint mounted as a native plugin, the
request instrumentation, and the exception filter that records failed statuses.
It is a leaf: nothing in the framework depends on it.

| Domain      | Owns                                                       |
| ----------- | ---------------------------------------------------------- |
| `registry/` | `MetricsRegistry`, metric kinds, validation, and rendering |
| `runtime/`  | `metricsPlugin`, the instrumentation hooks, and the filter |
| `module/`   | `MetricsModule.register` and the composed plugin module    |

`src/index.ts` is the only public barrel. Keep `*.types.ts` beside the runtime
that reads it.

## Invariants

- **The registry is bounded.** A new label set past `maxSeriesPerMetric` is
  dropped; never let a scrape or a label grow memory without a cap.
- **Labels use the route template.** The plugin and the exception filter read
  `context.route` before `context.path`, so a dynamic route reports `/users/:id`
  and not one series per id. `path` is the fallback for a literal matched route;
  when neither is present the label is `unmatched`, never the raw request URL.
- **The scrape can be authorized.** `authorize` runs before `registry.render()`
  and a false answer is `401` with `no-store`; never render collectors for an
  unauthorized scrape.
- **The scrape path is excluded from instrumentation.** Recording the scrape
  itself would make every scrape change the numbers it reports.
- **Statuses come from the response, then the filter.** The plugin reads the
  status a handler returned; the global `MetricsExceptionFilter` records the
  statuses of exceptions and declines them so the application's error path still
  answers.
- **Rendering is deterministic.** Metrics are sorted by name and label sets by
  their key; label values and help text are escaped. Do not emit a map's
  insertion order.
- **Collectors run once per render, synchronously.** They may set gauges only;
  do not let one throw, and do not register a collector that awaits.
- **Configuration failures are `AponiaError` with `INVALID_METRICS_OPTIONS`.**
- **The registry is process-local.** Never describe it as an aggregating
  backend; a multi-process deployment scrapes each process.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. The Bun
lane boots a real application through `AponiaFactory.create` and asserts the
scrape body after real requests, including a `201`, a `404`, and a `500`.
