import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parse, View } from "vega";
import { compile, type TopLevelSpec } from "vega-lite";
import type { PositionFieldDef } from "vega-lite/types_unstable/channeldef.js";

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
  const requestMeasurements = baseline.measurements
    .filter(({ group }) => group === "request")
    .map((measurement) => ({
      implementation: measurement.implementation,
      latencyMicroseconds: measurement.latencyMeanMs * 1_000,
      latencyLabel: `${(measurement.latencyMeanMs * 1_000).toFixed(1)} µs`,
      throughput: measurement.throughputMeanOps,
      throughputLabel: `${Math.round(measurement.throughputMeanOps).toLocaleString("en-US")} ops/s`,
    }));
  const startupMeasurements = baseline.measurements
    .filter(({ group }) => group === "startup")
    .map((measurement) => ({
      implementation: measurement.implementation,
      latencyMilliseconds: measurement.latencyMeanMs,
      latencyLabel: `${measurement.latencyMeanMs.toFixed(3)} ms`,
    }));

  const colors = ["#8f79ad", "#d29aaa", "#e1b96f"];
  const sharedColor = {
    field: "implementation",
    type: "nominal" as const,
    scale: {
      domain: requestMeasurements.map(({ implementation }) => implementation),
      range: colors,
    },
    legend: null,
  };
  const requestYAxis = createImplementationAxis(
    requestMeasurements.map(({ implementation }) => implementation),
  );
  const startupYAxis = createImplementationAxis(
    startupMeasurements.map(({ implementation }) => implementation),
  );

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    background: "#fff9fc",
    padding: 24,
    title: {
      text: "AponiaJS overhead garden  ✦",
      subtitle: [
        "Pure Elysia vs Aponia-registered native route vs Aponia wrapper",
        `${baseline.environment.runtime} · ${baseline.environment.platform} · lower latency is better`,
      ],
      anchor: "start",
      color: "#3e3349",
      fontSize: 28,
      fontWeight: 800,
      offset: 24,
      subtitleColor: "#786a84",
      subtitleFontSize: 13,
      subtitlePadding: 8,
    },
    spacing: 26,
    resolve: {
      scale: {
        color: "independent",
      },
    },
    vconcat: [
      {
        width: 700,
        height: 150,
        title: {
          text: "✿ Hot-path throughput",
          subtitle: "Higher is better · response body consumed",
          anchor: "start",
        },
        data: { values: requestMeasurements },
        layer: [
          {
            mark: { type: "bar", cornerRadiusEnd: 12, height: 26 },
            encoding: {
              x: {
                field: "throughput",
                type: "quantitative",
                axis: {
                  title: "operations per second",
                  gridColor: "#eee5f2",
                  gridDash: [3, 5],
                  labelColor: "#786a84",
                  titleColor: "#786a84",
                },
              },
              y: requestYAxis,
              color: sharedColor,
            },
          },
          {
            mark: { type: "text", align: "left", baseline: "middle", dx: 8, fontWeight: 800 },
            encoding: {
              x: { field: "throughput", type: "quantitative" },
              y: requestYAxis,
              text: { field: "throughputLabel", type: "nominal" },
              color: { value: "#4b4057" },
            },
          },
        ],
      },
      {
        width: 700,
        height: 150,
        title: {
          text: "♡ Hot-path mean latency",
          subtitle: "Lower is better · same request and response",
          anchor: "start",
        },
        data: { values: requestMeasurements },
        layer: [
          {
            mark: { type: "bar", cornerRadiusEnd: 12, height: 26 },
            encoding: {
              x: {
                field: "latencyMicroseconds",
                type: "quantitative",
                axis: {
                  title: "microseconds",
                  gridColor: "#eee5f2",
                  gridDash: [3, 5],
                  labelColor: "#786a84",
                  titleColor: "#786a84",
                },
              },
              y: requestYAxis,
              color: sharedColor,
            },
          },
          {
            mark: { type: "text", align: "left", baseline: "middle", dx: 8, fontWeight: 800 },
            encoding: {
              x: { field: "latencyMicroseconds", type: "quantitative" },
              y: requestYAxis,
              text: { field: "latencyLabel", type: "nominal" },
              color: { value: "#4b4057" },
            },
          },
        ],
      },
      {
        width: 700,
        height: 105,
        title: {
          text: "☾ Application startup",
          subtitle: "Route registration vs module graph and container initialization",
          anchor: "start",
        },
        data: { values: startupMeasurements },
        layer: [
          {
            mark: { type: "bar", cornerRadiusEnd: 12, height: 26 },
            encoding: {
              x: {
                field: "latencyMilliseconds",
                type: "quantitative",
                axis: {
                  title: "milliseconds",
                  gridColor: "#eee5f2",
                  gridDash: [3, 5],
                  labelColor: "#786a84",
                  titleColor: "#786a84",
                },
              },
              y: startupYAxis,
              color: {
                field: "implementation",
                type: "nominal",
                scale: {
                  domain: startupMeasurements.map(({ implementation }) => implementation),
                  range: ["#8f79ad", "#d29aaa"],
                },
                legend: null,
              },
            },
          },
          {
            mark: { type: "text", align: "left", baseline: "middle", dx: 8, fontWeight: 800 },
            encoding: {
              x: { field: "latencyMilliseconds", type: "quantitative" },
              y: startupYAxis,
              text: { field: "latencyLabel", type: "nominal" },
              color: { value: "#4b4057" },
            },
          },
        ],
      },
    ],
    config: {
      axis: {
        labelFont: "Nunito, ui-rounded, system-ui",
        titleFont: "Nunito, ui-rounded, system-ui",
      },
      title: {
        color: "#4b4057",
        font: "Nunito, ui-rounded, system-ui",
        fontSize: 17,
        fontWeight: 800,
        subtitleColor: "#8b7d94",
        subtitleFont: "Nunito, ui-rounded, system-ui",
        subtitleFontSize: 12,
        subtitlePadding: 5,
      },
      view: {
        cornerRadius: 18,
        fill: "#fffefe",
        stroke: "#eadff0",
        strokeWidth: 1.5,
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

function createImplementationAxis(order: readonly string[]): PositionFieldDef<string> {
  return {
    field: "implementation",
    type: "nominal" as const,
    sort: [...order],
    axis: {
      title: null,
      labelColor: "#4b4057",
      labelFontSize: 14,
      labelFontWeight: 700,
      labelPadding: 10,
      ticks: false,
      domain: false,
    },
  };
}
