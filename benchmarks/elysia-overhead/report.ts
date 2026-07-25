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
  const pureStartup = findMeasurement(baseline.measurements, "startup", "Pure Elysia");
  const aponiaStartup = findMeasurement(baseline.measurements, "startup", "Aponia factory");
  const throughputRetentionPercent = Math.round(
    (aponiaRequest.throughputMedianOps / pureRequest.throughputMedianOps) * 100,
  );
  const chartMeasurements = [
    createChartMeasurement("Elysia", pureRequest.throughputMedianOps),
    createChartMeasurement("Aponia", aponiaRequest.throughputMedianOps),
  ];
  const metricCards = [
    createMetricCard(
      "Request p50 · µs ↓",
      formatMicroseconds(pureRequest.latencyP50Ms),
      formatMicroseconds(aponiaRequest.latencyP50Ms),
    ),
    createMetricCard(
      "Request p95 · µs ↓",
      formatMicroseconds(pureRequest.latencyP95Ms),
      formatMicroseconds(aponiaRequest.latencyP95Ms),
    ),
    createMetricCard(
      "Request p99 · µs ↓",
      formatMicroseconds(pureRequest.latencyP99Ms),
      formatMicroseconds(aponiaRequest.latencyP99Ms),
    ),
    createMetricCard(
      "Startup p50 · µs ↓",
      formatMicroseconds(pureStartup.latencyP50Ms),
      formatMicroseconds(aponiaStartup.latencyP50Ms),
    ),
    createMetricCard(
      "Request CV · % ↓",
      pureRequest.coefficientOfVariationPercent.toFixed(2),
      aponiaRequest.coefficientOfVariationPercent.toFixed(2),
    ),
    createMetricCard(
      "Measured iterations",
      pureRequest.iterations.toLocaleString("en-US"),
      aponiaRequest.iterations.toLocaleString("en-US"),
    ),
  ];

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    background: "#121212",
    padding: {
      top: 48,
      right: 56,
      bottom: 52,
      left: 56,
    },
    title: {
      text: `${throughputRetentionPercent}% Throughput Retained`,
      subtitle: `Aponia vs Elysia · ${baseline.environment.runtime} · ${baseline.configuration.rounds} trials · ${baseline.environment.ci ? "CI" : "local"}`,
      anchor: "start",
      color: "#f4f4ef",
      font: "SF Pro Display, Geist Sans, Helvetica Neue, ui-sans-serif, system-ui",
      fontSize: 66,
      fontWeight: 400,
      limit: 1280,
      offset: 66,
      subtitleColor: "#b7b7b2",
      subtitleFont: "SF Pro Display, Geist Sans, Helvetica Neue, ui-sans-serif, system-ui",
      subtitleFontSize: 24,
      subtitleFontWeight: 400,
      subtitlePadding: 18,
    },
    spacing: 52,
    vconcat: [
      {
        width: 1280,
        height: 560,
        title: {
          text: "Throughput",
          subtitle: "Requests/sec · higher is better",
          anchor: "start",
          color: "#f4f4ef",
          font: "SF Pro Display, Geist Sans, Helvetica Neue, ui-sans-serif, system-ui",
          fontSize: 36,
          fontWeight: 400,
          offset: 24,
          subtitleColor: "#999995",
          subtitleFont: "SF Pro Display, Geist Sans, Helvetica Neue, ui-sans-serif, system-ui",
          subtitleFontSize: 20,
          subtitleFontWeight: 400,
          subtitlePadding: 8,
        },
        data: {
          values: chartMeasurements,
        },
        layer: [
          {
            mark: {
              type: "bar",
              size: 300,
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
                  labelFont: "SF Pro Display, Geist Sans, Helvetica Neue, ui-sans-serif, system-ui",
                  labelFontSize: 28,
                  labelFontWeight: 400,
                  labelPadding: 18,
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
              font: "SF Pro Display, Geist Sans, Helvetica Neue, ui-sans-serif, system-ui",
              fontSize: 36,
              fontWeight: 600,
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
      {
        title: {
          text: "Latency & reliability",
          subtitle: "Individual iterations · lower is better where marked ↓",
          anchor: "start",
          color: "#f4f4ef",
          font: "SF Pro Display, Geist Sans, Helvetica Neue, ui-sans-serif, system-ui",
          fontSize: 32,
          fontWeight: 400,
          offset: 22,
          subtitleColor: "#999995",
          subtitleFont: "SF Pro Display, Geist Sans, Helvetica Neue, ui-sans-serif, system-ui",
          subtitleFontSize: 19,
          subtitleFontWeight: 400,
          subtitlePadding: 8,
        },
        spacing: 16,
        vconcat: [
          {
            spacing: 16,
            hconcat: metricCards.slice(0, 3),
          },
          {
            spacing: 16,
            hconcat: metricCards.slice(3),
          },
        ],
      },
    ],
    config: {
      view: {
        fill: "#121212",
        stroke: "#3f3f3c",
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

function createChartMeasurement(implementation: "Elysia" | "Aponia", value: number) {
  return {
    implementation,
    value,
    valueLabel: Math.round(value).toLocaleString("en-US"),
    labelPosition: value * 0.45,
  };
}

function createMetricCard(title: string, elysiaValue: string, aponiaValue: string) {
  return {
    width: 416,
    height: 124,
    title: {
      text: title,
      anchor: "start" as const,
      color: "#d6d6d1",
      font: "SF Pro Display, Geist Sans, Helvetica Neue, ui-sans-serif, system-ui",
      fontSize: 21,
      fontWeight: 400 as const,
      offset: 16,
    },
    data: {
      values: [
        {
          implementation: "Elysia",
          valueLabel: elysiaValue,
        },
        {
          implementation: "Aponia",
          valueLabel: aponiaValue,
        },
      ],
    },
    mark: {
      type: "text" as const,
      baseline: "middle" as const,
      font: "SF Pro Display, Geist Sans, Helvetica Neue, ui-sans-serif, system-ui",
      fontSize: 30,
      fontWeight: 600 as const,
    },
    encoding: {
      x: {
        field: "implementation",
        type: "nominal" as const,
        sort: ["Elysia", "Aponia"],
        scale: {
          padding: 0.55,
        },
        axis: {
          title: null,
          domain: false,
          ticks: false,
          labelAngle: 0,
          labelColor: "#999995",
          labelFont: "SF Pro Display, Geist Sans, Helvetica Neue, ui-sans-serif, system-ui",
          labelFontSize: 17,
          labelFontWeight: 400 as const,
          labelPadding: 14,
        },
      },
      text: {
        field: "valueLabel",
        type: "nominal" as const,
      },
      color: {
        field: "implementation",
        type: "nominal" as const,
        sort: ["Elysia", "Aponia"],
        scale: {
          domain: ["Elysia", "Aponia"],
          range: ["#6f86f7", "#ffb84d"],
        },
        legend: null,
      },
    },
  };
}

function formatMicroseconds(milliseconds: number): string {
  return (milliseconds * 1_000).toFixed(3);
}
