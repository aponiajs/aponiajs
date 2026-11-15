import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { MetricsRegistry } from "../src/index.ts";

describe("MetricsRegistry", () => {
  test("counts, sets, and observes values", () => {
    const registry = new MetricsRegistry();
    const requests = registry.counter("requests", { help: "Requests." });
    const queue = registry.gauge("queue_depth", { help: "Queued jobs." });
    const latency = registry.histogram("latency", { buckets: [0.1, 1] });

    requests.inc();
    requests.inc({ route: "/users" }, 2);
    queue.set(5);
    queue.inc(undefined, 2);
    queue.dec(undefined, 1);
    latency.observe(0.05);
    latency.observe(0.5);
    latency.observe(2);

    expect(requests.value()).toBe(1);
    expect(requests.value({ route: "/users" })).toBe(2);
    expect(queue.value()).toBe(6);
    expect(latency.snapshot()).toEqual({ count: 3, sum: 2.55 });
  });

  test("ignores non-finite observations", () => {
    const registry = new MetricsRegistry();
    const requests = registry.counter("requests");
    const queue = registry.gauge("queue");
    const latency = registry.histogram("latency");

    requests.inc(undefined, Number.NaN);
    queue.set(Number.POSITIVE_INFINITY);
    queue.inc(undefined, Number.NaN);
    latency.observe(Number.NaN);

    expect(requests.value()).toBe(0);
    expect(queue.value()).toBe(0);
    expect(latency.snapshot()).toEqual({ count: 0, sum: 0 });
  });

  test("renders Prometheus text with sorted labels and escaped values", () => {
    const registry = new MetricsRegistry();
    registry
      .counter("z_total", { help: "Line one\nline two" })
      .inc({ b: 'say "hi"', a: "line\nbreak" });
    registry.histogram("a_seconds", { buckets: [0.5, 1] }).observe(0.25, { route: "/" });

    const text = registry.render();

    expect(text.split("\n")).toEqual([
      "# HELP a_seconds a_seconds",
      "# TYPE a_seconds histogram",
      'a_seconds_bucket{route="/",le="0.5"} 1',
      'a_seconds_bucket{route="/",le="1"} 1',
      'a_seconds_bucket{route="/",le="+Inf"} 1',
      'a_seconds_sum{route="/"} 0.25',
      'a_seconds_count{route="/"} 1',
      "# HELP z_total Line one\\nline two",
      "# TYPE z_total counter",
      'z_total{a="line\\nbreak",b="say \\"hi\\""} 1',
      "",
    ]);
    expect(registry.render()).toStartWith("# HELP a_seconds");
  });

  test("renders nothing when no metric exists and after clear", () => {
    const registry = new MetricsRegistry();
    expect(registry.render()).toBe("");

    registry.counter("one").inc();
    registry.clear();

    expect(registry.render()).toBe("");
  });

  test("refreshes gauges through a collector before each render", () => {
    const registry = new MetricsRegistry();
    const depth = registry.gauge("queue_depth");
    let value = 1;
    const unsubscribe = registry.registerCollector(() => {
      depth.set(value);
    });

    expect(registry.render()).toContain("queue_depth 1");
    value = 4;
    expect(registry.render()).toContain("queue_depth 4");
    unsubscribe();
    expect(registry.render()).toContain("queue_depth 4");
    expect(() => registry.registerCollector("no" as never)).toThrow(
      "The metrics registration is invalid",
    );
  });

  test("applies a prefix and shares one metric definition", () => {
    const registry = new MetricsRegistry({ prefix: "app" });
    const first = registry.counter("jobs", { help: "Jobs." });
    const second = registry.counter("jobs");

    first.inc();

    expect(second.value()).toBe(1);
    expect(registry.render()).toContain("# HELP app_jobs Jobs.");
  });

  test("drops a label set past its cap", () => {
    const registry = new MetricsRegistry({ maxSeriesPerMetric: 1 });
    const counter = registry.counter("capped");

    counter.inc({ route: "/one" });
    counter.inc({ route: "/two" });

    expect(counter.value({ route: "/one" })).toBe(1);
    expect(counter.value({ route: "/two" })).toBe(0);
  });

  test("refuses names, labels, kinds, and buckets it cannot render", () => {
    const registry = new MetricsRegistry();
    registry.counter("good");

    expect(capture(() => registry.counter("bad name")).code).toBe("INVALID_METRICS_OPTIONS");
    expect(capture(() => registry.histogram("good")).code).toBe("INVALID_METRICS_OPTIONS");
    expect(capture(() => registry.counter("good").inc({ le: "1" })).code).toBe(
      "INVALID_METRICS_OPTIONS",
    );
    expect(capture(() => registry.counter("good").inc({ "bad name": "x" })).code).toBe(
      "INVALID_METRICS_OPTIONS",
    );
    expect(capture(() => registry.counter("good").inc({ route: "x".repeat(257) })).code).toBe(
      "INVALID_METRICS_OPTIONS",
    );
  });

  test("reports every invalid registry option", () => {
    expect(capture(() => new MetricsRegistry({ prefix: "bad prefix" })).code).toBe(
      "INVALID_METRICS_OPTIONS",
    );
    expect(capture(() => new MetricsRegistry({ maxSeriesPerMetric: 0 })).code).toBe(
      "INVALID_METRICS_OPTIONS",
    );
    expect(capture(() => new MetricsRegistry({ buckets: [] })).code).toBe(
      "INVALID_METRICS_OPTIONS",
    );
    expect(capture(() => new MetricsRegistry({ buckets: [1, 1] })).code).toBe(
      "INVALID_METRICS_OPTIONS",
    );
    expect(capture(() => new MetricsRegistry({ buckets: [Number.NaN] })).code).toBe(
      "INVALID_METRICS_OPTIONS",
    );
    expect(registryHistogram([2, 1])).toBe("INVALID_METRICS_OPTIONS");
  });
});

function registryHistogram(buckets: readonly number[]): string | undefined {
  return capture(() => new MetricsRegistry().histogram("h", { buckets })).code;
}

function capture(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an AponiaError.");
}
