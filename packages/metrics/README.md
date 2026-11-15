# @aponiajs/metrics

Prometheus metrics for AponiaJS: a bounded registry, a scrape endpoint mounted
on the application's route table, and request instrumentation for every route.

```bash
bun add @aponiajs/metrics@alpha
```

## Use it

```ts
import { Module } from "@aponiajs/common";
import { MetricsExceptionFilter, MetricsModule, MetricsRegistry } from "@aponiajs/metrics";

const metrics = new MetricsRegistry();

@Module({ imports: [MetricsModule.register({ registry: metrics, path: "/metrics" })] })
export class AppModule {}

const application = await AponiaFactory.create(AppModule, {
  filters: [MetricsExceptionFilter],
});
```

A scrape of `GET /metrics` answers the Prometheus text format. The plugin
records two metrics for every mounted route:

- `http_requests_total{method,route,status}` — every answered request and every
  request a filter answered, with the registered route template as `route`.
- `http_request_duration_seconds{method,route}` — the duration of answered
  requests, in the registry's buckets.

`MetricsExceptionFilter` records the statuses of failed requests. Declare it as
a global filter; the route's own filters and the default Problem Details mapping
still answer the response.

The plugin also publishes `process_uptime_seconds`,
`process_resident_memory_bytes`, and `process_heap_used_bytes`, refreshed at
every scrape. Pass `processMetrics: false` to leave them out.

## Your own metrics

```ts
metrics.counter("orders_created_total").inc();
metrics.gauge("queue_depth").set(12);
metrics.histogram("checkout_seconds").observe(0.42);
metrics.render();
```

`registerCollector` adds a callback that refreshes gauges before every render,
which is how a value read from another service stays current without a timer.

## Bounds

Every metric keeps at most `maxSeriesPerMetric` label sets (default 1000); a new
set past the cap is dropped instead of growing the process. Names and label
names are validated when a metric is created. `MetricsRegistry` is
process-local: a scrape reads one instance, so a multi-process deployment needs
a Prometheus scrape per process or an aggregating gateway.

## Documentation

- [Agent surface](../../docs/agent/README.md)
- [Metrics guide](../../docs/metrics.md)
- [Published packages](../../docs/packages.md)
- [npm](https://www.npmjs.com/package/@aponiajs/metrics)
