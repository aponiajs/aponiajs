import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { coefficientOfVariation, median, quantile } from "simple-statistics";
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
  const pureStartup = findMeasurement(baseline.measurements, "startup", "Pure Elysia");
  const aponiaStartup = findMeasurement(baseline.measurements, "startup", "Aponia factory");
  const chartMeasurements = [
    createChartMeasurement(
      "Throughput · req/µs ↑",
      "Elysia",
      pureRequest.throughputMedianOps / 1_000_000,
      `${(pureRequest.throughputMedianOps / 1_000_000).toFixed(3)} req/µs`,
      pureRequest.trials.map((trial) => trial.throughputOps / 1_000_000),
    ),
    createChartMeasurement(
      "Throughput · req/µs ↑",
      "Aponia",
      aponiaRequest.throughputMedianOps / 1_000_000,
      `${(aponiaRequest.throughputMedianOps / 1_000_000).toFixed(3)} req/µs`,
      aponiaRequest.trials.map((trial) => trial.throughputOps / 1_000_000),
    ),
    createChartMeasurement(
      "Request p50 · µs ↓",
      "Elysia",
      pureRequest.latencyP50Ms * 1_000,
      `${(pureRequest.latencyP50Ms * 1_000).toFixed(3)} µs`,
      pureRequest.trials.map((trial) => trial.latencyP50Ms * 1_000),
    ),
    createChartMeasurement(
      "Request p50 · µs ↓",
      "Aponia",
      aponiaRequest.latencyP50Ms * 1_000,
      `${(aponiaRequest.latencyP50Ms * 1_000).toFixed(3)} µs`,
      aponiaRequest.trials.map((trial) => trial.latencyP50Ms * 1_000),
    ),
    createChartMeasurement(
      "Request p99 · µs ↓",
      "Elysia",
      pureRequest.latencyP99Ms * 1_000,
      `${(pureRequest.latencyP99Ms * 1_000).toFixed(3)} µs`,
      pureRequest.trials.map((trial) => trial.latencyP99Ms * 1_000),
    ),
    createChartMeasurement(
      "Request p99 · µs ↓",
      "Aponia",
      aponiaRequest.latencyP99Ms * 1_000,
      `${(aponiaRequest.latencyP99Ms * 1_000).toFixed(3)} µs`,
      aponiaRequest.trials.map((trial) => trial.latencyP99Ms * 1_000),
    ),
    createChartMeasurement(
      "Startup p50 · ms ↓",
      "Elysia",
      pureStartup.latencyP50Ms,
      `${pureStartup.latencyP50Ms.toFixed(3)} ms`,
      pureStartup.trials.map((trial) => trial.latencyP50Ms),
    ),
    createChartMeasurement(
      "Startup p50 · ms ↓",
      "Aponia",
      aponiaStartup.latencyP50Ms,
      `${aponiaStartup.latencyP50Ms.toFixed(3)} ms`,
      aponiaStartup.trials.map((trial) => trial.latencyP50Ms),
    ),
  ];

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    background: "#ffffff",
    padding: 24,
    title: {
      text: "Elysia vs Aponia",
      subtitle: `Median bars · IQR whiskers · ${baseline.configuration.rounds} order-balanced trials`,
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
        sort: [
          "Throughput · req/µs ↑",
          "Request p50 · µs ↓",
          "Request p99 · µs ↓",
          "Startup p50 · ms ↓",
        ],
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
      width: 168,
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
            type: "rule",
            color: "#242424",
            strokeWidth: 2,
          },
          encoding: {
            x: {
              field: "implementation",
              type: "nominal",
              sort: ["Elysia", "Aponia"],
            },
            y: {
              field: "lowerQuartile",
              type: "quantitative",
            },
            y2: {
              field: "upperQuartile",
            },
          },
        },
        {
          mark: {
            type: "tick",
            orient: "horizontal",
            color: "#242424",
            size: 14,
            thickness: 2,
          },
          encoding: {
            x: {
              field: "implementation",
              type: "nominal",
              sort: ["Elysia", "Aponia"],
            },
            y: {
              field: "lowerQuartile",
              type: "quantitative",
            },
          },
        },
        {
          mark: {
            type: "tick",
            orient: "horizontal",
            color: "#242424",
            size: 14,
            thickness: 2,
          },
          encoding: {
            x: {
              field: "implementation",
              type: "nominal",
              sort: ["Elysia", "Aponia"],
            },
            y: {
              field: "upperQuartile",
              type: "quantitative",
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
              field: "upperQuartile",
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
  trialValues: readonly number[],
) {
  return {
    metric,
    implementation,
    value,
    valueLabel,
    lowerQuartile: quantile(trialValues, 0.25),
    upperQuartile: quantile(trialValues, 0.75),
  };
}
