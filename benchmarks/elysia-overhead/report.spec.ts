import { describe, expect, test } from "bun:test";
import {
  calculateComparison,
  createChartSpec,
  type BenchmarkBaseline,
  type BenchmarkMeasurement,
  type BenchmarkTrial,
  summarizeTrials,
} from "./report.ts";

const measurements: BenchmarkMeasurement[] = [
  createMeasurement("request", "Pure Elysia", 0.01),
  createMeasurement("request", "Aponia native", 0.011),
  createMeasurement("request", "Aponia wrapper", 0.012),
  createMeasurement("startup", "Pure Elysia", 0.1),
  createMeasurement("startup", "Aponia factory", 0.2),
];

describe("benchmark reporting", () => {
  test("calculates wrapper and startup deltas from named baselines", () => {
    const comparison = calculateComparison(measurements);

    expect(comparison.requestMedianLatencyOverheadPercent).toBe(20);
    expect(comparison.requestMedianThroughputDeltaPercent).toBeCloseTo(-16.67, 2);
    expect(comparison.wrapperOnlyMedianLatencyOverheadPercent).toBeCloseTo(9.09, 2);
    expect(comparison.startupMedianLatencyOverheadPercent).toBe(100);
  });

  test("summarizes independent trials with robust central values", () => {
    const trials = [createTrial(1, 1, 0.009), createTrial(2, 2, 0.01), createTrial(3, 3, 0.02)];

    const measurement = summarizeTrials("request", "Pure Elysia", trials);

    expect(measurement.latencyP50Ms).toBe(0.01);
    expect(measurement.latencyP95Ms).toBeCloseTo(0.012);
    expect(measurement.latencyP99Ms).toBeCloseTo(0.014);
    expect(measurement.throughputMedianOps).toBe(90_000);
    expect(measurement.coefficientOfVariationPercent).toBeGreaterThan(0);
    expect(measurement.iterations).toBe(3_000);
  });

  test("builds a reproducible grouped raw-unit chart", () => {
    const baseline: BenchmarkBaseline = {
      schemaVersion: 2,
      measuredAt: "2026-07-25T00:00:00.000Z",
      tool: {
        name: "mitata",
        version: "test",
      },
      environment: {
        runtime: "Bun test",
        platform: "linux x64",
        cpu: "Test CPU",
        logicalCores: 4,
        ci: true,
      },
      configuration: {
        rounds: 6,
        requestTimeMsPerCase: 100,
        startupTimeMsPerCase: 100,
        warmupSamples: 8,
        minimumSamples: 20,
        batching: false,
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
    expect(serializedChart).toContain("Request p50 · µs");
    expect(serializedChart).toContain("Request p99 · µs");
    expect(serializedChart).toContain("Startup p50 · ms");
    expect(serializedChart).toContain("order-balanced trials");
    expect(serializedChart).toContain("IQR whiskers");
    expect(serializedChart).toContain("lowerQuartile");
    expect(serializedChart).toContain("upperQuartile");
    expect(serializedChart).not.toContain("Aponia native");
    expect(serializedChart).not.toContain("CI REPRODUCIBLE");
    expect(serializedChart).not.toContain("Elysia baseline = 100");
    expect(serializedChart).toContain("0.075 req/µs");
    expect(serializedChart).toContain("12.000 µs");
    expect(serializedChart).toContain("18.000 µs");
    expect(serializedChart).toContain("0.200 ms");
    expect(serializedChart).toContain("#4665ff");
  });
});

function createMeasurement(
  group: BenchmarkMeasurement["group"],
  implementation: string,
  latencyP50Ms: number,
): BenchmarkMeasurement {
  return {
    group,
    implementation,
    latencyMeanMs: latencyP50Ms * 1.05,
    latencyP50Ms,
    latencyP95Ms: latencyP50Ms * 1.5,
    latencyP99Ms: latencyP50Ms * 1.5,
    throughputMedianOps: 900 / latencyP50Ms,
    coefficientOfVariationPercent: 1,
    iterations: 100,
    trials: [createTrial(1, 1, latencyP50Ms)],
  };
}

function createTrial(round: number, order: number, latencyP50Ms: number): BenchmarkTrial {
  return {
    round,
    order,
    latencyMeanMs: latencyP50Ms * 1.05,
    latencyP50Ms,
    latencyP95Ms: latencyP50Ms * 1.2,
    latencyP99Ms: latencyP50Ms * 1.4,
    throughputOps: 900 / latencyP50Ms,
    iterations: 1_000,
  };
}
