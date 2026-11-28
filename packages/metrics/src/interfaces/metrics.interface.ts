import type { ConfigurableModuleAsyncOptions } from "@aponiajs/common";

/** Label key-value pairs attached to a metric sample. */
export type MetricLabels = Readonly<Record<string, string | number | boolean>>;

/** A monotonically increasing Prometheus counter. */
export interface CounterMetric {
  inc(labels?: MetricLabels, value?: number): void;
}

/** A Prometheus gauge that can increase, decrease, or be set directly. */
export interface GaugeMetric {
  set(value: number, labels?: MetricLabels): void;
  inc(labels?: MetricLabels, value?: number): void;
  dec(labels?: MetricLabels, value?: number): void;
}

/** A Prometheus histogram observing distributions across configured buckets. */
export interface HistogramMetric {
  observe(value: number, labels?: MetricLabels): void;
}

/** Configuration options for a metric definition. */
export interface MetricDefinitionOptions {
  readonly name: string;
  readonly help: string;
  readonly labelNames?: readonly string[];
}

/** Configuration options for a histogram definition. */
export interface HistogramDefinitionOptions extends MetricDefinitionOptions {
  readonly buckets?: readonly number[];
}

/** Options accepted by `MetricsModule.forRoot`. */
export interface MetricsModuleOptions {
  /** Endpoint path serving Prometheus exposition text; defaults to `"/metrics"`. */
  readonly path?: string;
  /** Whether to expose the HTTP metrics endpoint; defaults to `true`. */
  readonly exposeEndpoint?: boolean;
  /** Whether to collect default runtime memory/uptime gauges; defaults to `true`. */
  readonly collectDefaultMetrics?: boolean;
  /** Whether to record HTTP request count and duration histogram; defaults to `true`. */
  readonly collectHttpMetrics?: boolean;
  /** Histogram bucket boundaries in seconds for HTTP request duration. */
  readonly httpBuckets?: readonly number[];
  /** Maximum distinct label combinations per metric; defaults to `2000`. */
  readonly maxLabelCombinations?: number;
  /** Optional prefix prepended to built-in metric names. */
  readonly prefix?: string;
  /** Optional request authorizer for the metrics endpoint. */
  readonly authorize?: (request: Request) => boolean | Promise<boolean>;
}

/** Validated options resolved by `MetricsModule`. */
export interface ResolvedMetricsOptions {
  readonly path: string;
  readonly exposeEndpoint: boolean;
  readonly collectDefaultMetrics: boolean;
  readonly collectHttpMetrics: boolean;
  readonly httpBuckets: readonly number[];
  readonly maxLabelCombinations: number;
  readonly prefix: string;
  readonly authorize: ((request: Request) => boolean | Promise<boolean>) | undefined;
}

/** Asynchronous options accepted by `MetricsModule.forRootAsync`. */
export type MetricsModuleAsyncOptions = ConfigurableModuleAsyncOptions<MetricsModuleOptions>;
