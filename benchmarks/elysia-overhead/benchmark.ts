import { cpus } from "node:os";
import { defineModule } from "@aponiajs/common";
import { AponiaFactory, defineElysiaController } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import { measure } from "mitata";
import mitataPackage from "mitata/package.json" with { type: "json" };
import { quantileSorted } from "simple-statistics";
import {
  calculateComparison,
  type BenchmarkBaseline,
  type BenchmarkMeasurement,
  type BenchmarkTrial,
  summarizeTrials,
  writeBenchmarkArtifacts,
} from "./report.ts";

interface BenchmarkCase {
  readonly name: string;
  readonly run: () => Promise<void>;
}

const responseBody = "Hello from AponiaJS";
const request = new Request("http://localhost/hello");
const requestTimeMsPerCase = readPositiveNumber("APONIA_BENCH_REQUEST_MS", 500);
const startupTimeMsPerCase = readPositiveNumber("APONIA_BENCH_STARTUP_MS", 250);
const rounds = readPositiveInteger("APONIA_BENCH_ROUNDS", 6);
const warmupSamples = readPositiveInteger("APONIA_BENCH_WARMUP_SAMPLES", 8);
const minimumSamples = readPositiveInteger("APONIA_BENCH_MIN_SAMPLES", 20);

class BenchmarkController {
  getHello(): string {
    return responseBody;
  }
}

const benchmarkController = defineElysiaController(BenchmarkController, {
  inject: [],
  buildPlugin: (controller) => new Elysia().get("/hello", () => controller.getHello()),
});
const benchmarkModule = defineModule({
  id: "BenchmarkModule",
  controllers: [benchmarkController],
});

const pureApplication = new Elysia().get("/hello", () => responseBody);
await pureApplication.modules;
const aponiaApplication = await AponiaFactory.create(benchmarkModule, { logger: false });
const aponiaNativeApplication = aponiaApplication.getNativeApplication();

await assertEquivalentResponses([
  ["Pure Elysia", pureApplication.handle(request)],
  ["Aponia native", aponiaNativeApplication.handle(request)],
  ["Aponia wrapper", aponiaApplication.handle(request)],
]);

const requestCases: readonly BenchmarkCase[] = [
  {
    name: "Pure Elysia",
    run: () => consumeResponse(pureApplication.handle(request)),
  },
  {
    name: "Aponia native",
    run: () => consumeResponse(aponiaNativeApplication.handle(request)),
  },
  {
    name: "Aponia wrapper",
    run: () => consumeResponse(aponiaApplication.handle(request)),
  },
];
const startupCases: readonly BenchmarkCase[] = [
  {
    name: "Pure Elysia",
    run: async () => {
      const application = new Elysia().get("/hello", () => responseBody);
      await application.modules;
    },
  },
  {
    name: "Aponia factory",
    run: async () => {
      const application = await AponiaFactory.create(benchmarkModule, { logger: false });
      await application.close();
    },
  },
];

console.log(`Measuring ${rounds} order-balanced trials with Mitata...`);
const measurements = [
  ...(await runBalancedTrials("request", requestCases, requestTimeMsPerCase)),
  ...(await runBalancedTrials("startup", startupCases, startupTimeMsPerCase)),
];
const baseline: BenchmarkBaseline = {
  schemaVersion: 2,
  measuredAt: new Date().toISOString(),
  tool: {
    name: "mitata",
    version: mitataPackage.version,
  },
  environment: {
    runtime: `Bun ${Bun.version}`,
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? "Unknown CPU",
    logicalCores: cpus().length,
    ci: Bun.env.CI === "true",
  },
  configuration: {
    rounds,
    requestTimeMsPerCase,
    startupTimeMsPerCase,
    warmupSamples,
    minimumSamples,
    batching: false,
  },
  measurements,
  comparison: calculateComparison(measurements),
};

await writeBenchmarkArtifacts(
  baseline,
  ".benchmark-output/elysia-overhead.json",
  ".benchmark-output/elysia-overhead.svg",
);
await aponiaApplication.close();

console.table(
  measurements.map((measurement) => ({
    benchmark: `${measurement.group} · ${measurement.implementation}`,
    "p50 (ms)": measurement.latencyP50Ms.toFixed(6),
    "p95 (ms)": measurement.latencyP95Ms.toFixed(6),
    "p99 (ms)": measurement.latencyP99Ms.toFixed(6),
    "CV (%)": measurement.coefficientOfVariationPercent.toFixed(2),
    iterations: measurement.iterations,
  })),
);
console.table({
  "Request p50 latency overhead": formatDelta(
    baseline.comparison.requestMedianLatencyOverheadPercent,
  ),
  "Request median throughput delta": formatDelta(
    baseline.comparison.requestMedianThroughputDeltaPercent,
  ),
  "Wrapper-only p50 latency overhead": formatDelta(
    baseline.comparison.wrapperOnlyMedianLatencyOverheadPercent,
  ),
  "Startup p50 latency overhead": formatDelta(
    baseline.comparison.startupMedianLatencyOverheadPercent,
  ),
});
console.log("Wrote .benchmark-output/elysia-overhead.json");
console.log("Wrote .benchmark-output/elysia-overhead.svg");

async function runBalancedTrials(
  group: BenchmarkMeasurement["group"],
  cases: readonly BenchmarkCase[],
  timeMsPerCase: number,
): Promise<BenchmarkMeasurement[]> {
  const trialsByName = new Map<string, BenchmarkTrial[]>(
    cases.map((benchmarkCase) => [benchmarkCase.name, []]),
  );

  for (let round = 1; round <= rounds; round += 1) {
    const offset = (round - 1) % cases.length;
    const orderedCases = [...cases.slice(offset), ...cases.slice(0, offset)];

    for (const [order, benchmarkCase] of orderedCases.entries()) {
      const stats = await measure(benchmarkCase.run, {
        min_cpu_time: timeMsPerCase * 1_000_000,
        min_samples: minimumSamples,
        max_samples: 1_000_000,
        warmup_samples: warmupSamples,
        batch_threshold: 0,
      });
      const trials = trialsByName.get(benchmarkCase.name);
      if (!trials) {
        throw new Error(`Missing trial collection for ${benchmarkCase.name}.`);
      }
      trials.push({
        round,
        order: order + 1,
        latencyMeanMs: nanosecondsToMilliseconds(stats.avg),
        latencyP50Ms: nanosecondsToMilliseconds(quantileSorted(stats.samples, 0.5)),
        latencyP95Ms: nanosecondsToMilliseconds(quantileSorted(stats.samples, 0.95)),
        latencyP99Ms: nanosecondsToMilliseconds(quantileSorted(stats.samples, 0.99)),
        throughputOps: 1_000_000_000 / stats.avg,
        iterations: stats.ticks,
      });
    }
  }

  return cases.map((benchmarkCase) =>
    summarizeTrials(group, benchmarkCase.name, trialsByName.get(benchmarkCase.name) ?? []),
  );
}

function nanosecondsToMilliseconds(nanoseconds: number): number {
  return nanoseconds / 1_000_000;
}

async function consumeResponse(response: Response | Promise<Response>): Promise<void> {
  const resolved = await response;
  if (resolved.status !== 200) {
    throw new Error(`Expected HTTP 200 but received ${resolved.status}.`);
  }
  await resolved.text();
}

async function assertEquivalentResponses(
  responses: readonly (readonly [string, Response | Promise<Response>])[],
): Promise<void> {
  for (const [name, response] of responses) {
    const resolved = await response;
    const body = await resolved.text();
    if (resolved.status !== 200 || body !== responseBody) {
      throw new Error(`${name} did not return the expected response.`);
    }
  }
}

function readPositiveNumber(name: string, fallback: number): number {
  const value = Bun.env[name];
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = readPositiveNumber(name, fallback);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function formatDelta(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
