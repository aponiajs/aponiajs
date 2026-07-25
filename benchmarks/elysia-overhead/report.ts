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

  const colors = ["#73737b", "#8ba2ff", "#1348dc"];
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
    background: "#000000",
    padding: 20,
    title: {
      text: "APONIA / PERFORMANCE LAB",
      subtitle: [
        "Elysia overhead · reproducible framework benchmark",
        "Pure runtime → native registration → application wrapper",
      ],
      anchor: "start",
      color: "#ffffff",
      font: "Inter, ui-sans-serif, system-ui",
      fontSize: 30,
      fontWeight: 600,
      offset: 28,
      subtitleColor: "#9a9aa2",
      subtitleFont: "ui-monospace, SFMono-Regular, Menlo, monospace",
      subtitleFontSize: 12,
      subtitlePadding: 10,
    },
    spacing: 34,
    resolve: {
      scale: {
        color: "independent",
      },
    },
    vconcat: [
      {
        width: 760,
        height: 64,
        data: {
          values: [
            {
              workspace: "aponiajs",
              file: "elysia-overhead.bench.ts",
              environment: `${baseline.environment.runtime} · ${baseline.environment.platform}`,
            },
          ],
        },
        layer: [
          {
            mark: { type: "rect", color: "#141416" },
            encoding: {
              x: { value: 0 },
              x2: { value: 760 },
              y: { value: 0 },
              y2: { value: 64 },
            },
          },
          {
            mark: { type: "rect", color: "#1f1f22" },
            encoding: {
              x: { value: 16 },
              x2: { value: 270 },
              y: { value: 30 },
              y2: { value: 64 },
            },
          },
          {
            mark: { type: "rect", color: "#1348dc" },
            encoding: {
              x: { value: 16 },
              x2: { value: 270 },
              y: { value: 62 },
              y2: { value: 64 },
            },
          },
          {
            mark: {
              type: "text",
              align: "left",
              baseline: "middle",
              color: "#ffffff",
              font: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 11,
              fontWeight: 600,
            },
            encoding: {
              x: { value: 16 },
              y: { value: 16 },
              text: { field: "workspace", type: "nominal" },
            },
          },
          {
            mark: {
              type: "text",
              align: "right",
              baseline: "middle",
              color: "#81818a",
              font: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 10,
            },
            encoding: {
              x: { value: 744 },
              y: { value: 16 },
              text: { field: "environment", type: "nominal" },
            },
          },
          {
            mark: {
              type: "text",
              align: "left",
              baseline: "middle",
              color: "#d8d8dc",
              font: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 11,
            },
            encoding: {
              x: { value: 32 },
              y: { value: 47 },
              text: { field: "file", type: "nominal" },
            },
          },
        ],
      },
      {
        width: 760,
        height: 150,
        title: {
          text: "BENCHMARK 01  /  HOT-PATH THROUGHPUT",
          subtitle: "Higher is better · response body consumed",
          anchor: "start",
        },
        data: { values: requestMeasurements },
        layer: [
          {
            mark: { type: "bar", cornerRadiusEnd: 2, height: 20 },
            encoding: {
              x: {
                field: "throughput",
                type: "quantitative",
                axis: {
                  title: "operations per second",
                  domainColor: "#333338",
                  gridColor: "#252529",
                  gridDash: [1, 5],
                  labelColor: "#8d8d96",
                  tickColor: "#333338",
                  titleColor: "#8d8d96",
                },
              },
              y: requestYAxis,
              color: sharedColor,
            },
          },
          {
            mark: {
              type: "text",
              align: "left",
              baseline: "middle",
              dx: 8,
              font: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontWeight: 600,
            },
            encoding: {
              x: { field: "throughput", type: "quantitative" },
              y: requestYAxis,
              text: { field: "throughputLabel", type: "nominal" },
              color: { value: "#f4f4f5" },
            },
          },
        ],
      },
      {
        width: 760,
        height: 150,
        title: {
          text: "BENCHMARK 02  /  HOT-PATH MEAN LATENCY",
          subtitle: "Lower is better · same request and response",
          anchor: "start",
        },
        data: { values: requestMeasurements },
        layer: [
          {
            mark: { type: "bar", cornerRadiusEnd: 2, height: 20 },
            encoding: {
              x: {
                field: "latencyMicroseconds",
                type: "quantitative",
                axis: {
                  title: "microseconds",
                  domainColor: "#333338",
                  gridColor: "#252529",
                  gridDash: [1, 5],
                  labelColor: "#8d8d96",
                  tickColor: "#333338",
                  titleColor: "#8d8d96",
                },
              },
              y: requestYAxis,
              color: sharedColor,
            },
          },
          {
            mark: {
              type: "text",
              align: "left",
              baseline: "middle",
              dx: 8,
              font: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontWeight: 600,
            },
            encoding: {
              x: { field: "latencyMicroseconds", type: "quantitative" },
              y: requestYAxis,
              text: { field: "latencyLabel", type: "nominal" },
              color: { value: "#f4f4f5" },
            },
          },
        ],
      },
      {
        width: 760,
        height: 105,
        title: {
          text: "BENCHMARK 03  /  APPLICATION STARTUP",
          subtitle: "Route registration vs module graph and container initialization",
          anchor: "start",
        },
        data: { values: startupMeasurements },
        layer: [
          {
            mark: { type: "bar", cornerRadiusEnd: 2, height: 20 },
            encoding: {
              x: {
                field: "latencyMilliseconds",
                type: "quantitative",
                axis: {
                  title: "milliseconds",
                  domainColor: "#333338",
                  gridColor: "#252529",
                  gridDash: [1, 5],
                  labelColor: "#8d8d96",
                  tickColor: "#333338",
                  titleColor: "#8d8d96",
                },
              },
              y: startupYAxis,
              color: {
                field: "implementation",
                type: "nominal",
                scale: {
                  domain: startupMeasurements.map(({ implementation }) => implementation),
                  range: ["#73737b", "#1348dc"],
                },
                legend: null,
              },
            },
          },
          {
            mark: {
              type: "text",
              align: "left",
              baseline: "middle",
              dx: 8,
              font: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontWeight: 600,
            },
            encoding: {
              x: { field: "latencyMilliseconds", type: "quantitative" },
              y: startupYAxis,
              text: { field: "latencyLabel", type: "nominal" },
              color: { value: "#f4f4f5" },
            },
          },
        ],
      },
      {
        width: 760,
        height: 30,
        data: {
          values: [
            {
              status: "CI REPRODUCIBLE",
              detail: "same runner · same process · report artifact retained 14 days",
            },
          ],
        },
        layer: [
          {
            mark: { type: "rect", color: "#1348dc" },
            encoding: {
              x: { value: 0 },
              x2: { value: 760 },
              y: { value: 0 },
              y2: { value: 30 },
            },
          },
          {
            mark: {
              type: "text",
              align: "left",
              baseline: "middle",
              color: "#ffffff",
              font: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 10,
              fontWeight: 600,
            },
            encoding: {
              x: { value: 14 },
              y: { value: 15 },
              text: { field: "status", type: "nominal" },
            },
          },
          {
            mark: {
              type: "text",
              align: "right",
              baseline: "middle",
              color: "#ffffff",
              font: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 10,
            },
            encoding: {
              x: { value: 746 },
              y: { value: 15 },
              text: { field: "detail", type: "nominal" },
            },
          },
        ],
      },
    ],
    config: {
      axis: {
        labelFont: "ui-monospace, SFMono-Regular, Menlo, monospace",
        titleFont: "ui-monospace, SFMono-Regular, Menlo, monospace",
      },
      title: {
        color: "#ffffff",
        font: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 13,
        fontWeight: 600,
        subtitleColor: "#8d8d96",
        subtitleFont: "ui-monospace, SFMono-Regular, Menlo, monospace",
        subtitleFontSize: 11,
        subtitlePadding: 5,
      },
      view: {
        cornerRadius: 0,
        fill: "#101012",
        stroke: "#29292e",
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

function createImplementationAxis(order: readonly string[]): PositionFieldDef<string> {
  return {
    field: "implementation",
    type: "nominal" as const,
    sort: [...order],
    axis: {
      title: null,
      labelColor: "#d8d8dc",
      labelFontSize: 13,
      labelFontWeight: 500,
      labelPadding: 10,
      ticks: false,
      domain: false,
    },
  };
}
