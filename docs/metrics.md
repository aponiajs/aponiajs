# Metrics

`@aponiajs/metrics` serves Prometheus metrics for an application.

```ts
const metrics = new MetricsRegistry();

@Module({ imports: [MetricsModule.register({ registry: metrics, path: "/metrics" })] })
export class AppModule {}

const application = await AponiaFactory.create(AppModule, {
  filters: [MetricsExceptionFilter],
});
```

`GET /metrics` answers the Prometheus text format and is excluded from the
instrumentation, so a scrape never changes the numbers it reports.

## Recorded metrics

| Metric                          | Type      | Labels                      |
| ------------------------------- | --------- | --------------------------- |
| `http_requests_total`           | counter   | `method`, `route`, `status` |
| `http_request_duration_seconds` | histogram | `method`, `route`           |

The `route` label is the registered route template: a request to
`/widgets/42` counts under `/widgets/:id`, so one route stays one series.

The plugin also publishes the process gauges `process_uptime_seconds`,
`process_resident_memory_bytes`, and `process_heap_used_bytes`; set
`processMetrics: false` to omit them. `registerCollector` refreshes a gauge
before every render, which is how a value read elsewhere stays current.

Success statuses come from the response the handler answered; a `201` set
through `@HttpStatus()` is recorded as `201`. Failures are recorded by
`MetricsExceptionFilter`, which is why the application declares it as a global
filter: the route's own error path answers the response, so the plugin's hooks
never observe the exception.

## Application metrics

```ts
metrics.counter("orders_created_total", { help: "Orders created." }).inc();
metrics.gauge("queue_depth").set(queue.stats().pending);
metrics.histogram("checkout_seconds").observe(seconds);
```

`render()` returns the text a scrape serves; `clear()` drops every metric. A
prefix can be set on the registry so every name shares one namespace.

## Bounds

A metric keeps at most `maxSeriesPerMetric` label sets (default 1000). A new set
past the cap is dropped rather than growing the process, so an unbounded label
such as a user id degrades the metric instead of the service. Names and label
names are validated when a metric is created; an observation that is not finite
is ignored.

The registry is process-local. Each process renders its own view, so a
deployment with several instances scrapes each one or aggregates downstream.

See the [package README](../packages/metrics/README.md) for the full contract.
