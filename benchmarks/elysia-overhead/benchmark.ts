import { cpus } from "node:os";
import { defineModule } from "@aponiajs/common";
import { AponiaFactory, defineElysiaController } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import { Bench, type Task } from "tinybench";
import {
  calculateComparison,
  type BenchmarkBaseline,
  type BenchmarkMeasurement,
  writeBenchmarkArtifacts,
} from "./report.ts";

const responseBody = "Hello from AponiaJS";
const request = new Request("http://localhost/hello");
const requestTimeMs = readDuration("APONIA_BENCH_REQUEST_MS", 1_500);
const startupTimeMs = readDuration("APONIA_BENCH_STARTUP_MS", 750);
const warmupTimeMs = readDuration("APONIA_BENCH_WARMUP_MS", 250);

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

const requestBench = new Bench({
  name: "hot request path",
  time: requestTimeMs,
  warmupTime: warmupTimeMs,
  iterations: 128,
  warmupIterations: 32,
});

requestBench
  .add(
    "Pure Elysia",
    async () => {
      await consumeResponse(pureApplication.handle(request));
    },
    { async: true },
  )
  .add(
    "Aponia native",
    async () => {
      await consumeResponse(aponiaNativeApplication.handle(request));
    },
    { async: true },
  )
  .add(
    "Aponia wrapper",
    async () => {
      await consumeResponse(aponiaApplication.handle(request));
    },
    { async: true },
  );

const startupBench = new Bench({
  name: "application startup",
  time: startupTimeMs,
  warmupTime: warmupTimeMs,
  iterations: 64,
  warmupIterations: 16,
});

startupBench
  .add(
    "Pure Elysia",
    async () => {
      const application = new Elysia().get("/hello", () => responseBody);
      await application.modules;
    },
    { async: true },
  )
  .add(
    "Aponia factory",
    async () => {
      await AponiaFactory.create(benchmarkModule, { logger: false });
    },
    { async: true },
  );

console.log("Warming and measuring the hot request path...");
await requestBench.run();
console.table(requestBench.table());

console.log("Warming and measuring application startup...");
await startupBench.run();
console.table(startupBench.table());

const measurements = [
  ...toMeasurements("request", requestBench.tasks),
  ...toMeasurements("startup", startupBench.tasks),
];
const baseline: BenchmarkBaseline = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  environment: {
    runtime: `Bun ${Bun.version}`,
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? "Unknown CPU",
  },
  configuration: {
    requestTimeMs,
    startupTimeMs,
    warmupTimeMs,
  },
  measurements,
  comparison: calculateComparison(measurements),
};

await writeBenchmarkArtifacts(
  baseline,
  ".ecc/benchmarks/elysia-overhead.json",
  "assets/benchmarks/elysia-overhead-editor.svg",
);
await aponiaApplication.close();

console.table({
  "Request latency overhead": formatDelta(baseline.comparison.requestLatencyOverheadPercent),
  "Request throughput delta": formatDelta(baseline.comparison.requestThroughputDeltaPercent),
  "Wrapper-only latency overhead": formatDelta(
    baseline.comparison.wrapperOnlyLatencyOverheadPercent,
  ),
  "Startup latency overhead": formatDelta(baseline.comparison.startupLatencyOverheadPercent),
});
console.log("Wrote .ecc/benchmarks/elysia-overhead.json");
console.log("Wrote assets/benchmarks/elysia-overhead-editor.svg");

function toMeasurements(
  group: BenchmarkMeasurement["group"],
  tasks: readonly Task[],
): BenchmarkMeasurement[] {
  return tasks.map((task) => {
    const result = task.result;
    if (result.state !== "completed") {
      throw new Error(`Benchmark "${task.name}" ended in state "${result.state}".`);
    }
    return {
      group,
      implementation: task.name,
      latencyMeanMs: result.latency.mean,
      latencyP50Ms: result.latency.p50,
      latencyP99Ms: result.latency.p99,
      throughputMeanOps: result.throughput.mean,
      relativeMarginOfError: result.latency.rme,
      samples: result.latency.samplesCount,
    };
  });
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

function readDuration(name: string, fallback: number): number {
  const value = Bun.env[name];
  if (value === undefined) {
    return fallback;
  }
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`${name} must be a positive number of milliseconds.`);
  }
  return duration;
}

function formatDelta(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
