import { Injectable } from "@aponiajs/common";
import type {
  CounterMetric,
  GaugeMetric,
  HistogramDefinitionOptions,
  HistogramMetric,
  MetricDefinitionOptions,
  MetricLabels,
  ResolvedMetricsOptions,
} from "./interfaces/metrics.interface.ts";
import { DEFAULT_HTTP_BUCKETS } from "./metrics.constants.ts";

interface StoredCounter {
  readonly kind: "counter";
  readonly name: string;
  readonly help: string;
  readonly values: Map<string, { labels: MetricLabels; value: number }>;
}

interface StoredGauge {
  readonly kind: "gauge";
  readonly name: string;
  readonly help: string;
  readonly values: Map<string, { labels: MetricLabels; value: number }>;
}

interface StoredHistogram {
  readonly kind: "histogram";
  readonly name: string;
  readonly help: string;
  readonly buckets: readonly number[];
  readonly values: Map<
    string,
    { labels: MetricLabels; counts: number[]; sum: number; count: number }
  >;
}

type StoredMetric = StoredCounter | StoredGauge | StoredHistogram;

/**
 * Zero-dependency Prometheus metrics registry and text exposition service.
 */
@Injectable()
export class MetricsService {
  readonly #options: ResolvedMetricsOptions;
  readonly #metrics = new Map<string, StoredMetric>();
  readonly #httpRequestsTotal: CounterMetric;
  readonly #httpRequestDuration: HistogramMetric;
  readonly #startedAtMs = Date.now();

  constructor(options: ResolvedMetricsOptions) {
    this.#options = options;
    const prefix = options.prefix;
    this.#httpRequestsTotal = this.counter({
      name: `${prefix}http_requests_total`,
      help: "Total number of HTTP requests processed.",
    });
    this.#httpRequestDuration = this.histogram({
      name: `${prefix}http_request_duration_seconds`,
      help: "HTTP request latency in seconds.",
      buckets: options.httpBuckets.length > 0 ? options.httpBuckets : DEFAULT_HTTP_BUCKETS,
    });
  }

  /** Registers or retrieves a Prometheus counter. */
  counter(definition: MetricDefinitionOptions): CounterMetric {
    const existing = this.#metrics.get(definition.name);
    if (existing !== undefined) {
      if (existing.kind !== "counter") {
        throw new Error(`Metric "${definition.name}" is already registered as ${existing.kind}.`);
      }
      return this.#wrapCounter(existing);
    }
    const stored: StoredCounter = {
      kind: "counter",
      name: definition.name,
      help: definition.help,
      values: new Map(),
    };
    this.#metrics.set(definition.name, stored);
    return this.#wrapCounter(stored);
  }

  /** Registers or retrieves a Prometheus gauge. */
  gauge(definition: MetricDefinitionOptions): GaugeMetric {
    const existing = this.#metrics.get(definition.name);
    if (existing !== undefined) {
      if (existing.kind !== "gauge") {
        throw new Error(`Metric "${definition.name}" is already registered as ${existing.kind}.`);
      }
      return this.#wrapGauge(existing);
    }
    const stored: StoredGauge = {
      kind: "gauge",
      name: definition.name,
      help: definition.help,
      values: new Map(),
    };
    this.#metrics.set(definition.name, stored);
    return this.#wrapGauge(stored);
  }

  /** Registers or retrieves a Prometheus histogram. */
  histogram(definition: HistogramDefinitionOptions): HistogramMetric {
    const existing = this.#metrics.get(definition.name);
    if (existing !== undefined) {
      if (existing.kind !== "histogram") {
        throw new Error(`Metric "${definition.name}" is already registered as ${existing.kind}.`);
      }
      return this.#wrapHistogram(existing);
    }
    const buckets = [...(definition.buckets ?? DEFAULT_HTTP_BUCKETS)].sort((a, b) => a - b);
    const stored: StoredHistogram = {
      kind: "histogram",
      name: definition.name,
      help: definition.help,
      buckets,
      values: new Map(),
    };
    this.#metrics.set(definition.name, stored);
    return this.#wrapHistogram(stored);
  }

  /** Records one completed HTTP request in the built-in counter and histogram. */
  recordHttpRequest(method: string, route: string, status: number, durationSeconds: number): void {
    if (!this.#options.collectHttpMetrics) {
      return;
    }
    const labels: MetricLabels = {
      method: method.toUpperCase(),
      route,
      status: String(status),
    };
    this.#httpRequestsTotal.inc(labels);
    this.#httpRequestDuration.observe(durationSeconds, labels);
  }

  /** Renders all registered metrics in Prometheus text exposition format (`0.0.4`). */
  render(): string {
    const lines: string[] = [];

    if (this.#options.collectDefaultMetrics) {
      const prefix = this.#options.prefix;
      const memory = process.memoryUsage();
      const uptimeSeconds = (Date.now() - this.#startedAtMs) / 1000;
      lines.push(
        `# HELP ${prefix}process_resident_memory_bytes Resident memory size in bytes.`,
        `# TYPE ${prefix}process_resident_memory_bytes gauge`,
        `${prefix}process_resident_memory_bytes ${memory.rss}`,
        `# HELP ${prefix}process_heap_used_bytes Process heap used in bytes.`,
        `# TYPE ${prefix}process_heap_used_bytes gauge`,
        `${prefix}process_heap_used_bytes ${memory.heapUsed}`,
        `# HELP ${prefix}process_uptime_seconds Process uptime in seconds.`,
        `# TYPE ${prefix}process_uptime_seconds gauge`,
        `${prefix}process_uptime_seconds ${uptimeSeconds}`,
      );
    }

    for (const metric of this.#metrics.values()) {
      if (metric.values.size === 0) {
        continue;
      }
      lines.push(`# HELP ${metric.name} ${escapeHelp(metric.help)}`);
      lines.push(`# TYPE ${metric.name} ${metric.kind}`);

      if (metric.kind === "counter" || metric.kind === "gauge") {
        for (const entry of metric.values.values()) {
          lines.push(`${metric.name}${formatLabels(entry.labels)} ${entry.value}`);
        }
        continue;
      }

      for (const entry of metric.values.values()) {
        const baseLabels = formatLabels(entry.labels);
        let cumulative = 0;
        for (let i = 0; i < metric.buckets.length; i += 1) {
          cumulative += entry.counts[i]!;
          lines.push(
            `${metric.name}_bucket${formatLabels({ ...entry.labels, le: String(metric.buckets[i]!) })} ${cumulative}`,
          );
        }
        lines.push(
          `${metric.name}_bucket${formatLabels({ ...entry.labels, le: "+Inf" })} ${entry.count}`,
          `${metric.name}_sum${baseLabels} ${entry.sum}`,
          `${metric.name}_count${baseLabels} ${entry.count}`,
        );
      }
    }

    return `${lines.join("\n")}\n`;
  }

  /** Clears all recorded metric samples. */
  reset(): void {
    for (const metric of this.#metrics.values()) {
      metric.values.clear();
    }
  }

  #wrapCounter(stored: StoredCounter): CounterMetric {
    return {
      inc: (labels = {}, value = 1) => {
        if (!Number.isFinite(value) || value < 0) {
          throw new Error("Counter increment must be a non-negative finite number.");
        }
        const key = labelKey(labels);
        const existing = stored.values.get(key);
        if (existing !== undefined) {
          existing.value += value;
          return;
        }
        if (stored.values.size >= this.#options.maxLabelCombinations) {
          return;
        }
        stored.values.set(key, { labels: { ...labels }, value });
      },
    };
  }

  #wrapGauge(stored: StoredGauge): GaugeMetric {
    const update = (labels: MetricLabels, delta: number, absolute: boolean): void => {
      const key = labelKey(labels);
      const existing = stored.values.get(key);
      if (existing !== undefined) {
        existing.value = absolute ? delta : existing.value + delta;
        return;
      }
      if (stored.values.size >= this.#options.maxLabelCombinations) {
        return;
      }
      stored.values.set(key, { labels: { ...labels }, value: delta });
    };
    return {
      set: (value, labels = {}) => {
        if (!Number.isFinite(value)) {
          throw new Error("Gauge value must be finite.");
        }
        update(labels, value, true);
      },
      inc: (labels = {}, value = 1) => {
        if (!Number.isFinite(value)) {
          throw new Error("Gauge increment must be finite.");
        }
        update(labels, value, false);
      },
      dec: (labels = {}, value = 1) => {
        if (!Number.isFinite(value)) {
          throw new Error("Gauge decrement must be finite.");
        }
        update(labels, -value, false);
      },
    };
  }

  #wrapHistogram(stored: StoredHistogram): HistogramMetric {
    return {
      observe: (value, labels = {}) => {
        if (!Number.isFinite(value)) {
          return;
        }
        const key = labelKey(labels);
        let entry = stored.values.get(key);
        if (entry === undefined) {
          if (stored.values.size >= this.#options.maxLabelCombinations) {
            return;
          }
          entry = {
            labels: { ...labels },
            counts: Array.from<number>({ length: stored.buckets.length }).fill(0),
            sum: 0,
            count: 0,
          };
          stored.values.set(key, entry);
        }
        entry.sum += value;
        entry.count += 1;
        for (let i = 0; i < stored.buckets.length; i += 1) {
          if (value <= stored.buckets[i]!) {
            entry.counts[i]! += 1;
            break;
          }
        }
      },
    };
  }
}

function labelKey(labels: MetricLabels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) {
    return "";
  }
  return keys.map((key) => `${key}=${String(labels[key])}`).join("\u0000");
}

function formatLabels(labels: MetricLabels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) {
    return "";
  }
  const pairs = keys.map((key) => `${key}="${escapeLabelValue(String(labels[key]))}"`);
  return `{${pairs.join(",")}}`;
}

function escapeLabelValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function escapeHelp(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
}
