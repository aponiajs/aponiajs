/** One metric's label set. */
export type MetricLabels = Readonly<Record<string, string>>;

/** The options a counter or gauge accepts. */
export interface MetricOptions {
  /** The `# HELP` line; defaults to the metric name. */
  readonly help?: string;
}

/** The options a histogram accepts. */
export interface HistogramOptions extends MetricOptions {
  /** The bucket upper bounds, ascending; defaults to the HTTP latency set. */
  readonly buckets?: readonly number[];
}

/** A monotonic counter. */
export interface Counter {
  /** Adds `amount` (default `1`) to one label set. */
  inc(labels?: MetricLabels, amount?: number): void;
  /** The counter's current value for one label set. */
  value(labels?: MetricLabels): number;
}

/** A gauge that moves both ways. */
export interface Gauge {
  set(value: number, labels?: MetricLabels): void;
  inc(labels?: MetricLabels, amount?: number): void;
  dec(labels?: MetricLabels, amount?: number): void;
  value(labels?: MetricLabels): number;
}

/** A distribution observed in buckets. */
export interface Histogram {
  observe(value: number, labels?: MetricLabels): void;
  /** The observation count and sum for one label set. */
  snapshot(labels?: MetricLabels): { readonly count: number; readonly sum: number };
}

/** Registry construction options. */
export interface MetricsRegistryOptions {
  /** A prefix prepended to every metric name, with an underscore when absent. */
  readonly prefix?: string;
  /** How many label sets one metric may keep; defaults to 1000. */
  readonly maxSeriesPerMetric?: number;
  /** The default histogram buckets. */
  readonly buckets?: readonly number[];
}

/** A callback that refreshes gauges before one render. */
export type MetricCollector = () => void;
