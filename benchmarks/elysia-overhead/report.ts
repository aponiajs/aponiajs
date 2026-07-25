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
  const chartMeasurements = [
    createChartMeasurement(
      "Throughput · req/µs ↑",
      "Elysia",
      pureRequest.throughputMeanOps / 1_000_000,
      `${(pureRequest.throughputMeanOps / 1_000_000).toFixed(3)} req/µs`,
    ),
    createChartMeasurement(
      "Throughput · req/µs ↑",
      "Aponia",
      aponiaRequest.throughputMeanOps / 1_000_000,
      `${(aponiaRequest.throughputMeanOps / 1_000_000).toFixed(3)} req/µs`,
    ),
    createChartMeasurement(
      "Request latency · µs ↓",
      "Elysia",
      pureRequest.latencyMeanMs * 1_000,
      `${(pureRequest.latencyMeanMs * 1_000).toFixed(3)} µs`,
    ),
    createChartMeasurement(
      "Request latency · µs ↓",
      "Aponia",
      aponiaRequest.latencyMeanMs * 1_000,
      `${(aponiaRequest.latencyMeanMs * 1_000).toFixed(3)} µs`,
    ),
    createChartMeasurement(
      "Startup · ms ↓",
      "Elysia",
      pureStartup.latencyMeanMs,
      `${pureStartup.latencyMeanMs.toFixed(3)} ms`,
    ),
    createChartMeasurement(
      "Startup · ms ↓",
      "Aponia",
      aponiaStartup.latencyMeanMs,
      `${aponiaStartup.latencyMeanMs.toFixed(3)} ms`,
    ),
  ];

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    background: "#ffffff",
    padding: 24,
    title: {
      text: "Elysia vs Aponia",
      subtitle: "Measured values · ↑ higher is better · ↓ lower is better",
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
    data: { values: chartMeasurements },
    facet: {
      column: {
        field: "metric",
        type: "nominal",
        sort: ["Throughput · req/µs ↑", "Request latency · µs ↓", "Startup · ms ↓"],
        header: {
          title: null,
          labelColor: "#242424",
          labelFont: "Georgia, Times New Roman, serif",
          labelFontSize: 14,
          labelFontWeight: 700,
          labelPadding: 12,
        },
      },
    },
    spec: {
      width: 210,
      height: 300,
      layer: [
        {
          mark: { type: "bar", size: 68 },
          encoding: {
            x: {
              field: "implementation",
              type: "nominal",
              sort: ["Elysia", "Aponia"],
              axis: null,
            },
            y: {
              field: "value",
              type: "quantitative",
              axis: {
                title: null,
                domain: false,
                grid: true,
                gridColor: "#dddddd",
                gridWidth: 1,
                labelColor: "#4f4f4f",
                labelFont: "Inter, ui-sans-serif, system-ui",
                labelFontSize: 10,
                tickColor: "#b8b8b8",
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
            fontSize: 11,
            fontWeight: 700,
          },
          encoding: {
            x: {
              field: "implementation",
              type: "nominal",
              sort: ["Elysia", "Aponia"],
            },
            y: {
              field: "value",
              type: "quantitative",
            },
            text: {
              field: "valueLabel",
              type: "nominal",
            },
          },
        },
      ],
    },
    resolve: {
      scale: {
        y: "independent",
      },
    },
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

function createChartMeasurement(
  metric: string,
  implementation: "Elysia" | "Aponia",
  value: number,
  valueLabel: string,
) {
  return {
    metric,
    implementation,
    value,
    valueLabel,
  };
}
