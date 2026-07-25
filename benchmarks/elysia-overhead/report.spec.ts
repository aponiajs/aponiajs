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

  test("builds a focused throughput comparison chart", () => {
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

    expect("vconcat" in chart).toBe(true);
    expect(chart.background).toBe("#121212");
    expect(serializedChart).toContain("83% Throughput Retained");
    expect(serializedChart).toContain("Requests/sec");
    expect(serializedChart).toContain("90,000");
    expect(serializedChart).toContain("75,000");
    expect(serializedChart).toContain("Aponia vs pure Elysia");
    expect(serializedChart).not.toContain("Aponia native");
    expect(serializedChart).not.toContain("Request p50");
    expect(serializedChart).not.toContain("Request p99");
    expect(serializedChart).not.toContain("Startup p50");
    expect(serializedChart).not.toContain("IQR whiskers");
    expect(serializedChart).toContain("#6f86f7");
    expect(serializedChart).toContain("#ffb84d");
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
