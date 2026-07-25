import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { coefficientOfVariation, median } from "simple-statistics";
import { parse, View } from "vega";
import { compile, type TopLevelSpec } from "vega-lite";

export interface BenchmarkTrial {
  readonly round: number;
  readonly order: number;
  readonly latencyMeanMs: number;
  readonly latencyP50Ms: number;
  readonly latencyP95Ms: number;
  readonly latencyP99Ms: number;
  readonly throughputOps: number;
  readonly iterations: number;
}

export interface BenchmarkMeasurement {
  readonly group: "request" | "startup";
  readonly implementation: string;
  readonly latencyMeanMs: number;
  readonly latencyP50Ms: number;
  readonly latencyP95Ms: number;
  readonly latencyP99Ms: number;
  readonly throughputMedianOps: number;
  readonly coefficientOfVariationPercent: number;
  readonly iterations: number;
  readonly trials: readonly BenchmarkTrial[];
}

export interface BenchmarkComparison {
  readonly requestMedianLatencyOverheadPercent: number;
  readonly requestMedianThroughputDeltaPercent: number;
  readonly wrapperOnlyMedianLatencyOverheadPercent: number;
  readonly startupMedianLatencyOverheadPercent: number;
}

export interface BenchmarkBaseline {
  readonly schemaVersion: 2;
  readonly measuredAt: string;
  readonly tool: {
    readonly name: "mitata";
    readonly version: string;
  };
  readonly environment: {
    readonly runtime: string;
    readonly platform: string;
    readonly cpu: string;
    readonly logicalCores: number;
    readonly ci: boolean;
  };
  readonly configuration: {
    readonly rounds: number;
    readonly requestTimeMsPerCase: number;
    readonly startupTimeMsPerCase: number;
    readonly warmupSamples: number;
    readonly minimumSamples: number;
    readonly batching: false;
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
    requestMedianLatencyOverheadPercent: percentChange(
      pureRequest.latencyP50Ms,
      wrapperRequest.latencyP50Ms,
    ),
    requestMedianThroughputDeltaPercent: percentChange(
      pureRequest.throughputMedianOps,
      wrapperRequest.throughputMedianOps,
    ),
    wrapperOnlyMedianLatencyOverheadPercent: percentChange(
      nativeRequest.latencyP50Ms,
      wrapperRequest.latencyP50Ms,
    ),
    startupMedianLatencyOverheadPercent: percentChange(
      pureStartup.latencyP50Ms,
      aponiaStartup.latencyP50Ms,
    ),
  };
}

export function summarizeTrials(
  group: BenchmarkMeasurement["group"],
  implementation: string,
  trials: readonly BenchmarkTrial[],
): BenchmarkMeasurement {
  if (trials.length === 0) {
    throw new Error(`Cannot summarize ${implementation} without benchmark trials.`);
  }

  const latencyMeanMs = median(trials.map((trial) => trial.latencyMeanMs));
  const latencyP50Ms = median(trials.map((trial) => trial.latencyP50Ms));

  return {
    group,
    implementation,
    latencyMeanMs,
    latencyP50Ms,
    latencyP95Ms: median(trials.map((trial) => trial.latencyP95Ms)),
    latencyP99Ms: median(trials.map((trial) => trial.latencyP99Ms)),
    throughputMedianOps: median(trials.map((trial) => trial.throughputOps)),
    coefficientOfVariationPercent:
      trials.length === 1
        ? 0
        : coefficientOfVariation(trials.map((trial) => trial.latencyP50Ms)) * 100,
    iterations: trials.reduce((total, trial) => total + trial.iterations, 0),
    trials,
  };
}

export function createChartSpec(baseline: BenchmarkBaseline): TopLevelSpec {
  const pureRequest = findMeasurement(baseline.measurements, "request", "Pure Elysia");
  const aponiaRequest = findMeasurement(baseline.measurements, "request", "Aponia wrapper");
  const throughputRetentionPercent = Math.round(
    (aponiaRequest.throughputMedianOps / pureRequest.throughputMedianOps) * 100,
  );
  const chartMeasurements = [
    createChartMeasurement("Elysia", pureRequest.throughputMedianOps),
    createChartMeasurement("Aponia", aponiaRequest.throughputMedianOps),
  ];

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    background: "#121212",
    padding: {
      top: 62,
      right: 72,
      bottom: 64,
      left: 72,
    },
    title: {
      text: `${throughputRetentionPercent}% Throughput Retained`,
      subtitle: `Aponia vs pure Elysia · ${baseline.environment.runtime} · ${baseline.configuration.rounds} balanced trials`,
      anchor: "start",
      color: "#f4f4ef",
      font: "Inter, ui-sans-serif, system-ui",
      fontSize: 72,
      fontWeight: 400,
      limit: 1400,
      offset: 90,
      subtitleColor: "#b7b7b2",
      subtitleFont: "Inter, ui-sans-serif, system-ui",
      subtitleFontSize: 26,
      subtitleFontWeight: 400,
      subtitlePadding: 22,
    },
    vconcat: [
      {
        width: 1400,
        height: 520,
        title: {
          text: "Requests/sec",
          anchor: "middle",
          color: "#f4f4ef",
          font: "Inter, ui-sans-serif, system-ui",
          fontSize: 48,
          fontWeight: 400,
          offset: 28,
        },
        data: {
          values: chartMeasurements,
        },
        layer: [
          {
            mark: {
              type: "bar",
              size: 260,
            },
            encoding: {
              x: {
                field: "implementation",
                type: "nominal",
                sort: ["Elysia", "Aponia"],
                axis: {
                  title: null,
                  domain: false,
                  ticks: false,
                  labelAngle: 0,
                  labelColor: "#f4f4ef",
                  labelFont: "Inter, ui-sans-serif, system-ui",
                  labelFontSize: 30,
                  labelFontWeight: 400,
                  labelPadding: 22,
                },
              },
              y: {
                field: "value",
                type: "quantitative",
                scale: {
                  domain: [0, pureRequest.throughputMedianOps * 1.15],
                },
                axis: null,
              },
              color: {
                field: "implementation",
                type: "nominal",
                sort: ["Elysia", "Aponia"],
                scale: {
                  domain: ["Elysia", "Aponia"],
                  range: ["#6f86f7", "#ffb84d"],
                },
                legend: null,
              },
            },
          },
          {
            mark: {
              type: "text",
              baseline: "middle",
              color: "#121212",
              font: "Inter, ui-sans-serif, system-ui",
              fontSize: 32,
              fontWeight: 500,
            },
            encoding: {
              x: {
                field: "implementation",
                type: "nominal",
                sort: ["Elysia", "Aponia"],
              },
              y: {
                field: "labelPosition",
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
    ],
    config: {
      view: {
        fill: "#121212",
        stroke: "#e8e8e2",
        strokeWidth: 1.25,
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

function createChartMeasurement(implementation: "Elysia" | "Aponia", value: number) {
  return {
    implementation,
    value,
    valueLabel: Math.round(value).toLocaleString("en-US"),
    labelPosition: value * 0.45,
  };
}
