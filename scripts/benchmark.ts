import { performance } from "node:perf_hooks";
import {
  APP_GUARD,
  APP_PIPE,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  UseGuards,
  createToken,
  type CanActivate,
  type PipeTransform,
} from "@aponiajs/common";
import { t } from "elysia";
import { AponiaFactory } from "../packages/platform-elysia/src/index.ts";
import type { AponiaApplication } from "../packages/platform-elysia/src/index.ts";

/** One measured scenario: a name and the work one iteration performs. */
export interface BenchmarkCase {
  readonly name: string;
  run(): unknown;
}

/** What one case measured. Numbers are seconds-normalized operations per second. */
export interface BenchmarkResult {
  readonly name: string;
  readonly iterations: number;
  readonly opsPerSecond: number;
}

export interface BenchmarkOptions {
  /** Measured iterations per case. */
  readonly iterations?: number;
  /** Unmeasured iterations run first, so a lazy path is not counted as slow. */
  readonly warmup?: number;
}

const SINGLETON = createToken<string>("BENCHMARK_SINGLETON");

@Injectable()
class NoopGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Injectable()
class UpperPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return typeof value === "string" ? value.toUpperCase() : value;
  }
}

@Controller("bench")
@UseGuards(NoopGuard)
class BenchController {
  @Get("plain")
  plain(): { readonly ok: boolean } {
    return { ok: true };
  }

  @Post("validated", { body: t.Object({ name: t.String() }) })
  validated(@Body() body: { readonly name: string }): string {
    return body.name;
  }

  @Post("piped")
  piped(@Body("name") name: string): string {
    return name;
  }
}

@Module({
  controllers: [BenchController],
  providers: [
    NoopGuard,
    UpperPipe,
    { provide: SINGLETON, useValue: "value" },
    { provide: APP_GUARD, useValue: NoopGuard },
    { provide: APP_PIPE, useValue: UpperPipe },
  ],
})
class BenchmarkModule {}

async function application(): Promise<AponiaApplication> {
  return AponiaFactory.create(BenchmarkModule, { logger: false });
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

const postJson = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "benchmark" }),
} as const;

/**
 * The scenarios this release measures, built against a booted application.
 *
 * Each case isolates one layer a request crosses: the container's own
 * resolution, routing with and without a guard, and body validation. The
 * comparison is AponiaJS against itself between releases, not against another
 * framework: a number that moves is attributable to this repository.
 */
export function benchmarkCases(app: AponiaApplication): readonly BenchmarkCase[] {
  return Object.freeze([
    Object.freeze({
      name: "container.get (singleton)",
      run: () => app.get(SINGLETON),
    }),
    Object.freeze({
      name: "GET /bench/plain (guard + JSON)",
      run: () => app.handle(request("/bench/plain")),
    }),
    Object.freeze({
      name: "POST /bench/validated (body schema)",
      run: () => app.handle(request("/bench/validated", postJson)),
    }),
    Object.freeze({
      name: "POST /bench/piped (application pipe)",
      run: () => app.handle(request("/bench/piped", postJson)),
    }),
  ]);
}

/**
 * Runs every case and reports operations per second.
 *
 * A benchmark is evidence, not a test: it boots an application, measures, and
 * closes it. Callers that only need the shape — the guard spec — pass a tiny
 * iteration count.
 *
 * @param options - Iteration and warmup counts.
 * @returns One frozen result per case, in declaration order.
 */
export async function runBenchmark(
  options: BenchmarkOptions = {},
): Promise<readonly BenchmarkResult[]> {
  const iterations = options.iterations ?? 2_000;
  const warmup = options.warmup ?? 100;
  const app = await application();

  try {
    const results: BenchmarkResult[] = [];
    for (const benchmarkCase of benchmarkCases(app)) {
      for (let index = 0; index < warmup; index++) {
        await benchmarkCase.run();
      }

      const started = performance.now();
      for (let index = 0; index < iterations; index++) {
        await benchmarkCase.run();
      }
      const elapsed = performance.now() - started;

      results.push(
        Object.freeze({
          name: benchmarkCase.name,
          iterations,
          opsPerSecond: iterations / (elapsed / 1_000),
        }),
      );
    }
    return Object.freeze(results);
  } finally {
    await app.close();
  }
}

export function formatBenchmarkResult(result: BenchmarkResult): string {
  return `${result.name.padEnd(42)} ${Math.round(result.opsPerSecond)
    .toString()
    .padStart(9)} ops/s  (${result.iterations} iterations)`;
}

/** What one concurrent run held under a fixed deadline. */
export interface SoakResult {
  readonly requests: number;
  readonly failures: number;
  readonly requestsPerSecond: number;
  readonly p50Ms: number;
  readonly p99Ms: number;
}

export interface SoakOptions {
  /** How long the load runs, in seconds. */
  readonly seconds?: number;
  /** Requests kept in flight at once. */
  readonly concurrency?: number;
}

/**
 * Keeps concurrent requests flowing for a fixed time and reports what the
 * application answered.
 *
 * A soak is the one measurement a single-request benchmark cannot make: whether
 * the request path stays healthy while several requests share it. It asserts
 * nothing — the guard spec only checks the report's shape — and the caller
 * reads the failure count and the tail latency.
 *
 * @param options - Duration and concurrency.
 * @returns The request count, failures, throughput, and p50/p99 latency.
 */
export async function runSoak(options: SoakOptions = {}): Promise<SoakResult> {
  const seconds = options.seconds ?? 10;
  const concurrency = options.concurrency ?? 16;
  const app = await application();
  const deadline = performance.now() + seconds * 1_000;
  const latencies: number[] = [];
  let failures = 0;

  try {
    const worker = async (): Promise<void> => {
      while (performance.now() < deadline) {
        const started = performance.now();
        const response = await app.handle(request("/bench/plain"));
        await response.text();
        latencies.push(performance.now() - started);
        if (response.status !== 200) {
          failures++;
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } finally {
    await app.close();
  }

  const sorted = [...latencies].sort((left, right) => left - right);
  return Object.freeze({
    requests: sorted.length,
    failures,
    requestsPerSecond: sorted.length / seconds,
    p50Ms: percentile(sorted, 0.5),
    p99Ms: percentile(sorted, 0.99),
  });
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.floor(quantile * sorted.length));
  return sorted[index] ?? 0;
}

if (import.meta.main) {
  for (const result of await runBenchmark()) {
    console.log(formatBenchmarkResult(result));
  }

  if (process.argv.includes("--soak")) {
    const soak = await runSoak();
    console.log(
      `soak ${soak.requests} requests, ${soak.failures} failures, ${Math.round(soak.requestsPerSecond)} req/s, p50 ${soak.p50Ms.toFixed(1)}ms, p99 ${soak.p99Ms.toFixed(1)}ms`,
    );
  }
}
