import { AponiaError } from "@aponiajs/common";
import { defaultHistogramBuckets } from "./metrics.constants.ts";
import type {
  Counter,
  Gauge,
  Histogram,
  HistogramOptions,
  MetricCollector,
  MetricLabels,
  MetricOptions,
  MetricsRegistryOptions,
} from "./metrics.types.ts";

type MetricKind = "counter" | "gauge" | "histogram";

interface Series {
  readonly labels: MetricLabels;
  value: number;
  readonly buckets?: readonly number[];
  readonly counts?: number[];
  count: number;
  sum: number;
}

interface Metric {
  readonly name: string;
  readonly kind: MetricKind;
  readonly help: string;
  readonly buckets?: readonly number[];
  readonly series: Map<string, Series>;
}

const namePattern = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const labelNamePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const maxLabelLength = 256;

/**
 * A bounded Prometheus registry.
 *
 * Every metric keeps at most `maxSeriesPerMetric` label sets; a new set past
 * that cap is dropped rather than growing the process without limit. Names and
 * label names are validated when a metric is created, not on every observation.
 */
export class MetricsRegistry {
  readonly #prefix: string;
  readonly #maxSeriesPerMetric: number;
  readonly #defaultBuckets: readonly number[];
  readonly #metrics = new Map<string, Metric>();
  readonly #collectors = new Set<MetricCollector>();

  constructor(options: MetricsRegistryOptions = {}) {
    const prefix = options.prefix ?? "";
    if (prefix !== "" && !namePattern.test(prefix)) {
      throw invalidOption("prefix must be a valid Prometheus name");
    }
    const maxSeriesPerMetric = options.maxSeriesPerMetric ?? 1_000;
    if (!Number.isInteger(maxSeriesPerMetric) || maxSeriesPerMetric < 1) {
      throw invalidOption("maxSeriesPerMetric must be a positive integer");
    }
    const buckets = options.buckets ?? defaultHistogramBuckets;
    assertBuckets(buckets);
    this.#prefix = prefix === "" || prefix.endsWith("_") ? prefix : `${prefix}_`;
    this.#maxSeriesPerMetric = maxSeriesPerMetric;
    this.#defaultBuckets = Object.freeze([...buckets]);
  }

  /** Creates or reads one counter. */
  counter(name: string, options: MetricOptions = {}): Counter {
    const metric = this.#metric(name, "counter", options.help);
    return Object.freeze({
      inc: (labels?: MetricLabels, amount = 1): void => {
        const series = this.#series(metric, labels);
        if (series === undefined || !Number.isFinite(amount)) {
          return;
        }
        series.value += amount;
      },
      value: (labels?: MetricLabels): number => this.#series(metric, labels)?.value ?? 0,
    });
  }

  /** Creates or reads one gauge. */
  gauge(name: string, options: MetricOptions = {}): Gauge {
    const metric = this.#metric(name, "gauge", options.help);
    return Object.freeze({
      set: (value: number, labels?: MetricLabels): void => {
        const series = this.#series(metric, labels);
        if (series !== undefined && Number.isFinite(value)) {
          series.value = value;
        }
      },
      inc: (labels?: MetricLabels, amount = 1): void => {
        const series = this.#series(metric, labels);
        if (series !== undefined && Number.isFinite(amount)) {
          series.value += amount;
        }
      },
      dec: (labels?: MetricLabels, amount = 1): void => {
        const series = this.#series(metric, labels);
        if (series !== undefined && Number.isFinite(amount)) {
          series.value -= amount;
        }
      },
      value: (labels?: MetricLabels): number => this.#series(metric, labels)?.value ?? 0,
    });
  }

  /** Creates or reads one histogram. */
  histogram(name: string, options: HistogramOptions = {}): Histogram {
    const buckets = options.buckets === undefined ? this.#defaultBuckets : options.buckets;
    assertBuckets(buckets);
    const metric = this.#metric(name, "histogram", options.help, buckets);
    return Object.freeze({
      observe: (value: number, labels?: MetricLabels): void => {
        if (!Number.isFinite(value)) {
          return;
        }
        const series = this.#series(metric, labels);
        if (series === undefined) {
          return;
        }
        series.count += 1;
        series.sum += value;
        const counts = series.counts ?? [];
        for (const [index, bound] of (series.buckets ?? []).entries()) {
          if (value <= bound) {
            counts[index] = (counts[index] ?? 0) + 1;
          }
        }
      },
      snapshot: (labels?: MetricLabels): { count: number; sum: number } => {
        const series = this.#series(metric, labels);
        return Object.freeze({ count: series?.count ?? 0, sum: series?.sum ?? 0 });
      },
    });
  }

  /** Renders every metric in Prometheus text format, ordered by name. */
  render(): string {
    for (const collector of this.#collectors) {
      collector();
    }
    const lines: string[] = [];
    const metrics = [...this.#metrics.values()].toSorted((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const metric of metrics) {
      lines.push(`# HELP ${metric.name} ${escapeHelp(metric.help)}`);
      lines.push(`# TYPE ${metric.name} ${metric.kind}`);
      for (const series of metric.series.values()) {
        lines.push(...renderSeries(metric, series));
      }
    }
    return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  }

  /** Drops every metric and series. */
  clear(): void {
    this.#metrics.clear();
    this.#collectors.clear();
  }

  /** Registers a callback that refreshes gauges before every render. */
  registerCollector(collector: MetricCollector): () => void {
    if (typeof collector !== "function") {
      throw invalidOption("collector must be a function");
    }
    this.#collectors.add(collector);
    return () => {
      this.#collectors.delete(collector);
    };
  }

  #metric(
    name: string,
    kind: MetricKind,
    help: string | undefined,
    buckets?: readonly number[],
  ): Metric {
    const fullName = `${this.#prefix}${name}`;
    if (!namePattern.test(fullName)) {
      throw invalidOption(`${fullName} is not a valid Prometheus metric name`);
    }
    const existing = this.#metrics.get(fullName);
    if (existing !== undefined) {
      if (existing.kind !== kind) {
        throw invalidOption(`${fullName} is already registered as a ${existing.kind}`);
      }
      return existing;
    }
    const metric: Metric = Object.freeze({
      name: fullName,
      kind,
      help: help ?? fullName,
      ...(buckets === undefined ? {} : { buckets: Object.freeze([...buckets]) }),
      series: new Map<string, Series>(),
    });
    this.#metrics.set(fullName, metric);
    return metric;
  }

  #series(metric: Metric, labels: MetricLabels | undefined): Series | undefined {
    const normalized = normalizeLabels(labels);
    const key = seriesKey(normalized);
    const existing = metric.series.get(key);
    if (existing !== undefined) {
      return existing;
    }
    if (metric.series.size >= this.#maxSeriesPerMetric) {
      return undefined;
    }
    const series: Series = {
      labels: normalized,
      value: 0,
      ...(metric.buckets === undefined
        ? {}
        : {
            buckets: metric.buckets,
            counts: Array.from<number>({ length: metric.buckets.length }).fill(0),
          }),
      count: 0,
      sum: 0,
    };
    metric.series.set(key, series);
    return series;
  }
}

function renderSeries(metric: Metric, series: Series): string[] {
  const labels = (extra?: readonly [string, string]): string => {
    const pairs = Object.entries(series.labels).map(
      ([name, value]) => `${name}="${escapeLabelValue(value)}"`,
    );
    if (extra !== undefined) {
      pairs.push(`${extra[0]}="${escapeLabelValue(extra[1])}"`);
    }
    return pairs.length === 0 ? "" : `{${pairs.join(",")}}`;
  };

  if (metric.kind !== "histogram") {
    return [`${metric.name}${labels()} ${formatValue(series.value)}`];
  }
  const lines: string[] = [];
  const buckets = series.buckets ?? [];
  const counts = series.counts ?? [];
  for (const [index, bound] of buckets.entries()) {
    lines.push(`${metric.name}_bucket${labels(["le", formatValue(bound)])} ${counts[index] ?? 0}`);
  }
  lines.push(`${metric.name}_bucket${labels(["le", "+Inf"])} ${series.count}`);
  lines.push(`${metric.name}_sum${labels()} ${formatValue(series.sum)}`);
  lines.push(`${metric.name}_count${labels()} ${series.count}`);
  return lines;
}

function normalizeLabels(labels: MetricLabels | undefined): MetricLabels {
  if (labels === undefined) {
    return Object.freeze({});
  }
  const entries = Object.entries(labels).toSorted(([left], [right]) => left.localeCompare(right));
  const normalized: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!labelNamePattern.test(name) || name === "le") {
      throw invalidOption(`${name} is not a valid Prometheus label name`);
    }
    if (typeof value !== "string" || value.length > maxLabelLength) {
      throw invalidOption(
        `The label ${name} must be a string of at most ${maxLabelLength} characters`,
      );
    }
    normalized[name] = value;
  }
  return Object.freeze(normalized);
}

function seriesKey(labels: MetricLabels): string {
  return Object.entries(labels)
    .map(([name, value]) => `${name}=${value}`)
    .join("\u0000");
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function escapeLabelValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

function escapeHelp(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
}

function assertBuckets(buckets: readonly number[]): void {
  if (buckets.length === 0) {
    throw invalidOption("buckets must not be empty");
  }
  let previous = Number.NEGATIVE_INFINITY;
  for (const bound of buckets) {
    if (!Number.isFinite(bound) || bound <= previous) {
      throw invalidOption("buckets must be finite and strictly ascending");
    }
    previous = bound;
  }
}

function invalidOption(issue: string): AponiaError {
  return new AponiaError(
    "INVALID_METRICS_OPTIONS",
    `The metrics registration is invalid: ${issue}.`,
    { issues: Object.freeze([issue]) },
  );
}
