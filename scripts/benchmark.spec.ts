import { describe, expect, test } from "bun:test";
import { formatBenchmarkResult, runBenchmark, runSoak } from "./benchmark.ts";

describe("benchmark suite", () => {
  test("reports one finite measurement per case", async () => {
    const results = await runBenchmark({ iterations: 3, warmup: 1 });

    expect(results).toHaveLength(4);
    expect(new Set(results.map((result) => result.name)).size).toBe(results.length);
    for (const result of results) {
      expect(result.iterations).toBe(3);
      expect(Number.isFinite(result.opsPerSecond)).toBe(true);
      expect(result.opsPerSecond).toBeGreaterThan(0);
      expect(Object.isFrozen(result)).toBe(true);
    }
    expect(Object.isFrozen(results)).toBe(true);
  });

  test("formats one result as a single aligned line", () => {
    const line = formatBenchmarkResult({
      name: "container.get (singleton)",
      iterations: 2_000,
      opsPerSecond: 1_234_567,
    });

    expect(line).toContain("container.get (singleton)");
    expect(line).toContain("1234567 ops/s");
    expect(line).toContain("(2000 iterations)");
  });

  test("reports requests, failures, throughput, and tail latency", async () => {
    const soak = await runSoak({ seconds: 0.05, concurrency: 2 });

    expect(soak.requests).toBeGreaterThan(0);
    expect(soak.failures).toBe(0);
    expect(soak.requestsPerSecond).toBeGreaterThan(0);
    expect(soak.p50Ms).toBeGreaterThanOrEqual(0);
    expect(soak.p99Ms).toBeGreaterThanOrEqual(soak.p50Ms);
    expect(Object.isFrozen(soak)).toBe(true);
  });

  test("reports an empty run when the deadline has already passed", async () => {
    const soak = await runSoak({ seconds: 0, concurrency: 1 });

    expect(soak.requests).toBe(0);
    expect(soak.p50Ms).toBe(0);
    expect(soak.p99Ms).toBe(0);
  });

  test("keeps the request path above the release floor", async () => {
    // Deliberately generous: this fails a hang, a failure storm, or a collapse
    // in throughput, not a noisy CI runner. Compare two releases on one machine
    // for a regression reading; this floor is the contract the default lane can
    // keep.
    const soak = await runSoak({ seconds: 0.2, concurrency: 4 });

    expect(soak.failures).toBe(0);
    expect(soak.requests).toBeGreaterThan(0);
    expect(soak.requestsPerSecond).toBeGreaterThan(200);
    expect(soak.p99Ms).toBeLessThan(250);
  });
});
