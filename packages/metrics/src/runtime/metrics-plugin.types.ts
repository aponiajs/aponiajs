import type { MetricsRegistry } from "../registry/metrics-registry.ts";

/** Options `metricsPlugin` and `MetricsModule.register` accept. */
export interface MetricsPluginOptions {
  /** The scrape path the plugin serves; defaults to `/metrics`. */
  readonly path?: string;
  /** The registry the plugin records into; a new one is created when absent. */
  readonly registry?: MetricsRegistry;
  /** A prefix for every metric the registry holds. */
  readonly prefix?: string;
  /** How many label sets one metric may keep; defaults to 1000. */
  readonly maxSeriesPerMetric?: number;
  /** The latency buckets the request histogram uses. */
  readonly buckets?: readonly number[];
  /** Extra route templates the instrumentation skips. */
  readonly exclude?: readonly string[];
  /** Publishes the process uptime and memory gauges; defaults to true. */
  readonly processMetrics?: boolean;
}

/** Options the module forwards to the plugin. */
export type MetricsModuleOptions = MetricsPluginOptions;
