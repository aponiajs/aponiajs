import { describe, expect, test } from "bun:test";
import {
  calculateComparison,
  createChartSpec,
  type BenchmarkBaseline,
  type BenchmarkMeasurement,
} from "./report.ts";

const measurements: BenchmarkMeasurement[] = [
  createMeasurement("request", "Pure Elysia", 0.01, 100_000),
  createMeasurement("request", "Aponia native", 0.011, 95_000),
  createMeasurement("request", "Aponia wrapper", 0.012, 90_000),
  createMeasurement("startup", "Pure Elysia", 0.1, 10_000),
  createMeasurement("startup", "Aponia factory", 0.2, 5_000),
];

describe("benchmark reporting", () => {
  test("calculates wrapper and startup deltas from named baselines", () => {
    const comparison = calculateComparison(measurements);

    expect(comparison.requestLatencyOverheadPercent).toBe(20);
    expect(comparison.requestThroughputDeltaPercent).toBe(-10);
    expect(comparison.wrapperOnlyLatencyOverheadPercent).toBeCloseTo(9.09, 2);
    expect(comparison.startupLatencyOverheadPercent).toBe(100);
  });

  test("builds a reproducible grouped raw-unit chart", () => {
    const baseline: BenchmarkBaseline = {
      schemaVersion: 1,
      measuredAt: "2026-07-25T00:00:00.000Z",
      environment: {
        runtime: "Bun test",
        platform: "linux x64",
        cpu: "Test CPU",
      },
      configuration: {
        requestTimeMs: 100,
        startupTimeMs: 100,
        warmupTimeMs: 25,
      },
      measurements,
      comparison: calculateComparison(measurements),
    };

    const chart = createChartSpec(baseline);
    const serializedChart = JSON.stringify(chart);

    expect("facet" in chart).toBe(true);
    expect(chart.background).toBe("#ffffff");
    expect(serializedChart).toContain("Elysia vs Aponia");
    expect(serializedChart).toContain("req/µs");
    expect(serializedChart).toContain("Request latency · µs");
    expect(serializedChart).toContain("Startup · ms");
    expect(serializedChart).not.toContain("Aponia native");
    expect(serializedChart).not.toContain("CI REPRODUCIBLE");
    expect(serializedChart).not.toContain("Elysia baseline = 100");
    expect(serializedChart).toContain("0.090 req/µs");
    expect(serializedChart).toContain("12.000 µs");
    expect(serializedChart).toContain("0.200 ms");
    expect(serializedChart).toContain("#4665ff");
  });
});

function createMeasurement(
  group: BenchmarkMeasurement["group"],
  implementation: string,
  latencyMeanMs: number,
  throughputMeanOps: number,
): BenchmarkMeasurement {
  return {
    group,
    implementation,
    latencyMeanMs,
    latencyP50Ms: latencyMeanMs,
    latencyP99Ms: latencyMeanMs,
    throughputMeanOps,
    relativeMarginOfError: 1,
    samples: 100,
  };
}
