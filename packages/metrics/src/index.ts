/**
 * `@aponiajs/metrics` — Prometheus metrics for an Aponia application.
 *
 * The package owns a bounded registry, a scrape endpoint mounted on the
 * application's route table, and request instrumentation for every route. It
 * chooses no exporter: a scrape reads the text the registry renders.
 */
export { MetricsModule } from "./metrics.module.ts";
export { createMetricsInstrumentation, renderMetricsScrape } from "./metrics-instrumentation.ts";
export { MetricsExceptionFilter } from "./metrics.filter.ts";
export { MetricsRegistry } from "./registry/metrics.registry.ts";
export { metricsContentType, defaultHistogramBuckets } from "./registry/metrics.constants.ts";
export type {
  MetricsModuleAsyncOptions,
  MetricsModuleOptions,
  MetricsPluginOptions,
  ResolvedMetricsOptions,
} from "./metrics-plugin.types.ts";
export type {
  Counter,
  Gauge,
  Histogram,
  HistogramOptions,
  MetricLabels,
  MetricCollector,
  MetricOptions,
  MetricsRegistryOptions,
} from "./interfaces/metrics.interface.ts";
