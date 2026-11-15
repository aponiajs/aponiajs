/**
 * `@aponiajs/metrics` — Prometheus metrics for an Aponia application.
 *
 * The package owns a bounded registry, a scrape endpoint mounted on the
 * application's route table, and request instrumentation for every route. It
 * chooses no exporter: a scrape reads the text the registry renders.
 */
export { MetricsModule } from "./module/metrics-module.ts";
export { metricsPlugin } from "./runtime/metrics-plugin.ts";
export { MetricsExceptionFilter } from "./runtime/metrics-exception.filter.ts";
export { MetricsRegistry } from "./registry/metrics-registry.ts";
export { metricsContentType, defaultHistogramBuckets } from "./registry/metrics.constants.ts";
export type { MetricsModuleOptions, MetricsPluginOptions } from "./runtime/metrics-plugin.types.ts";
export type {
  Counter,
  Gauge,
  Histogram,
  HistogramOptions,
  MetricLabels,
  MetricCollector,
  MetricOptions,
  MetricsRegistryOptions,
} from "./registry/metrics.types.ts";
