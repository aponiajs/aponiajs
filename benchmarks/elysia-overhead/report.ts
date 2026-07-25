import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parse, View } from "vega";
import { compile, type TopLevelSpec } from "vega-lite";

export interface BenchmarkMeasurement {
  readonly group: "request" | "startup";
  readonly implementation: string;
  readonly latencyMeanMs: number;
  readonly latencyP50Ms: number;
  readonly latencyP99Ms: number;
  readonly throughputMeanOps: number;
  readonly relativeMarginOfError: number;
  readonly samples: number;
}

export interface BenchmarkComparison {
  readonly requestLatencyOverheadPercent: number;
  readonly requestThroughputDeltaPercent: number;
  readonly wrapperOnlyLatencyOverheadPercent: number;
  readonly startupLatencyOverheadPercent: number;
}

export interface BenchmarkBaseline {
  readonly schemaVersion: 1;
  readonly measuredAt: string;
  readonly environment: {
    readonly runtime: string;
    readonly platform: string;
    readonly cpu: string;
  };
  readonly configuration: {
    readonly requestTimeMs: number;
    readonly startupTimeMs: number;
    readonly warmupTimeMs: number;
  };
  readonly measurements: readonly BenchmarkMeasurement[];
  readonly comparison: BenchmarkComparison;
}

export function calculateComparison(
  measurements: readonly BenchmarkMeasurement[],
): BenchmarkComparison {
  const pureRequest = findMeasurement(measurements, "request", "Pure Elysia");
  const nativeRequest = findMeasurement(measurements, "request", "Aponia native");
  const wrapperRequest = findMeasurement(measurements, "request", "Aponia wrapper");
  const pureStartup = findMeasurement(measurements, "startup", "Pure Elysia");
  const aponiaStartup = findMeasurement(measurements, "startup", "Aponia factory");

  return {
    requestLatencyOverheadPercent: percentChange(
      pureRequest.latencyMeanMs,
      wrapperRequest.latencyMeanMs,
    ),
    requestThroughputDeltaPercent: percentChange(
      pureRequest.throughputMeanOps,
      wrapperRequest.throughputMeanOps,
    ),
    wrapperOnlyLatencyOverheadPercent: percentChange(
      nativeRequest.latencyMeanMs,
      wrapperRequest.latencyMeanMs,
    ),
    startupLatencyOverheadPercent: percentChange(
      pureStartup.latencyMeanMs,
      aponiaStartup.latencyMeanMs,
    ),
  };
}

export function createChartSpec(baseline: BenchmarkBaseline): TopLevelSpec {
  const pureRequest = findMeasurement(baseline.measurements, "request", "Pure Elysia");
  const aponiaRequest = findMeasurement(baseline.measurements, "request", "Aponia wrapper");
  const pureStartup = findMeasurement(baseline.measurements, "startup", "Pure Elysia");
  const aponiaStartup = findMeasurement(baseline.measurements, "startup", "Aponia factory");
  const relativeMeasurements = [
    createRelativeMeasurement("Throughput", "Elysia", 100),
    createRelativeMeasurement(
      "Throughput",
      "Aponia",
      (aponiaRequest.throughputMeanOps / pureRequest.throughputMeanOps) * 100,
    ),
    createRelativeMeasurement("Request latency", "Elysia", 100),
    createRelativeMeasurement(
      "Request latency",
      "Aponia",
      (pureRequest.latencyMeanMs / aponiaRequest.latencyMeanMs) * 100,
    ),
    createRelativeMeasurement("Startup", "Elysia", 100),
    createRelativeMeasurement(
      "Startup",
      "Aponia",
      (pureStartup.latencyMeanMs / aponiaStartup.latencyMeanMs) * 100,
    ),
  ];

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    background: "#ffffff",
    padding: 24,
    title: {
      text: "Elysia vs Aponia",
      subtitle: "Relative performance · Elysia baseline = 100 · higher is better",
      anchor: "start",
      color: "#242424",
      font: "Georgia, Times New Roman, serif",
      fontSize: 24,
      fontWeight: 700,
      offset: 20,
      subtitleColor: "#5e5e5e",
      subtitleFont: "Inter, ui-sans-serif, system-ui",
      subtitleFontSize: 12,
      subtitlePadding: 7,
    },
    width: 680,
    height: 350,
    data: { values: relativeMeasurements },
    layer: [
      {
        mark: { type: "bar", size: 72 },
        encoding: {
          x: {
            field: "metric",
            type: "nominal",
            sort: ["Throughput", "Request latency", "Startup"],
            axis: {
              title: null,
              labelAngle: 0,
              labelColor: "#242424",
              labelFont: "Georgia, Times New Roman, serif",
              labelFontSize: 14,
              labelFontWeight: 700,
              labelPadding: 12,
            },
          },
          xOffset: {
            field: "implementation",
            sort: ["Elysia", "Aponia"],
          },
          y: {
            field: "score",
            type: "quantitative",
            scale: { domain: [0, 105] },
            axis: {
              title: "Relative performance (%)",
              values: [0, 20, 40, 60, 80, 100],
              domain: false,
              grid: true,
              gridColor: "#dddddd",
              gridWidth: 1,
              labelColor: "#4f4f4f",
              labelFont: "Inter, ui-sans-serif, system-ui",
              labelFontSize: 11,
              tickColor: "#b8b8b8",
              titleColor: "#242424",
              titleFont: "Georgia, Times New Roman, serif",
              titleFontSize: 13,
              titleFontWeight: 700,
              titlePadding: 12,
            },
          },
          color: {
            field: "implementation",
            type: "nominal",
            sort: ["Elysia", "Aponia"],
            scale: {
              domain: ["Elysia", "Aponia"],
              range: ["#c7c7c7", "#4665ff"],
            },
            legend: {
              title: null,
              orient: "top",
              direction: "horizontal",
              labelColor: "#242424",
              labelFont: "Georgia, Times New Roman, serif",
              labelFontSize: 13,
              labelFontWeight: 700,
              symbolSize: 180,
              symbolType: "square",
              offset: 12,
            },
          },
        },
      },
      {
        mark: {
          type: "text",
          baseline: "bottom",
          dy: -5,
          color: "#242424",
          font: "Georgia, Times New Roman, serif",
          fontSize: 12,
          fontWeight: 700,
        },
        encoding: {
          x: {
            field: "metric",
            type: "nominal",
            sort: ["Throughput", "Request latency", "Startup"],
          },
          xOffset: {
            field: "implementation",
            sort: ["Elysia", "Aponia"],
          },
          y: {
            field: "score",
            type: "quantitative",
            scale: { domain: [0, 105] },
          },
          text: {
            field: "scoreLabel",
            type: "nominal",
          },
        },
      },
    ],
    config: {
      view: {
        fill: "#ffffff",
        stroke: "#cccccc",
        strokeWidth: 1,
      },
    },
  };
}

export async function writeBenchmarkArtifacts(
  baseline: BenchmarkBaseline,
  baselinePath: string,
  chartPath: string,
): Promise<void> {
  await Promise.all([
    mkdir(dirname(baselinePath), { recursive: true }),
    mkdir(dirname(chartPath), { recursive: true }),
  ]);
  const chart = createChartSpec(baseline);
  const vegaSpec = compile(chart).spec;
  const view = new View(parse(vegaSpec), { renderer: "none" });
  const svg = await view.toSVG();

  await Promise.all([
    Bun.write(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`),
    Bun.write(chartPath, svg),
  ]);
  view.finalize();
}

function findMeasurement(
  measurements: readonly BenchmarkMeasurement[],
  group: BenchmarkMeasurement["group"],
  implementation: string,
): BenchmarkMeasurement {
  const measurement = measurements.find(
    (candidate) => candidate.group === group && candidate.implementation === implementation,
  );
  if (!measurement) {
    throw new Error(`Missing ${group} benchmark for ${implementation}.`);
  }
  return measurement;
}

function percentChange(baseline: number, candidate: number): number {
  if (baseline === 0) {
    throw new Error("Cannot calculate a percentage from a zero baseline.");
  }
  return ((candidate - baseline) / baseline) * 100;
}

function createRelativeMeasurement(
  metric: string,
  implementation: "Elysia" | "Aponia",
  score: number,
) {
  return {
    metric,
    implementation,
    score,
    scoreLabel: score.toFixed(1),
  };
}
