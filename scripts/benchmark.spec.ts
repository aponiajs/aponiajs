import { describe, expect, test } from "bun:test";
import { formatBenchmarkResult, runBenchmark } from "./benchmark.ts";

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
});
