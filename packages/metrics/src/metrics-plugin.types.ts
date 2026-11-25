import type { ModuleAsyncOptions } from "@aponiajs/common";
import type { MetricsRegistry } from "./registry/metrics.registry.ts";

/** Options `createMetricsInstrumentation` and `MetricsModule` accept. */
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
  /** Protects the scrape route; `false` answers `401` before rendering. */
  readonly authorize?: (request: Request) => boolean | Promise<boolean>;
}

/** Options the module forwards to the instrumentation and the scrape route. */
export type MetricsModuleOptions = MetricsPluginOptions;

/** The options one registration resolved, with the registry every provider shares. */
export interface ResolvedMetricsOptions extends MetricsPluginOptions {
  readonly registry: MetricsRegistry;
}

/** The registration options a factory supplies. */
export type MetricsModuleAsyncOptions = ModuleAsyncOptions<MetricsModuleOptions>;
