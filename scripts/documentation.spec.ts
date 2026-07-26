import { describe, expect, test } from "bun:test";
import { updateBenchmarkVersionReferences } from "./sync-version-references.ts";

const cliDocumentation = [
  "README.md",
  "docs/cli.md",
  "docs/packages.md",
  "packages/cli/README.md",
] as const;

describe("CLI documentation", () => {
  test("uses the globally installed aponia command consistently", async () => {
    const documents = await Promise.all(cliDocumentation.map((path) => Bun.file(path).text()));

    for (const content of documents) {
      expect(content).not.toContain("bunx aponia");
      expect(content).not.toContain("bun add --dev @aponiajs/cli");
      expect(content).toContain("bun add --global @aponiajs/cli");
    }
  });
});

describe("benchmark documentation", () => {
  test("synchronizes both benchmark links without changing other content", () => {
    const document =
      "chart: benchmark-results/elysia-overhead.svg?v=0.3.17\njson: benchmark-results/elysia-overhead.json?v=0.3.17\n";

    expect(updateBenchmarkVersionReferences(document, "0.3.18")).toBe(
      "chart: benchmark-results/elysia-overhead.svg?v=0.3.18\njson: benchmark-results/elysia-overhead.json?v=0.3.18\n",
    );
  });

  test("uses only the versioned CI benchmark in the public README", async () => {
    const [readme, benchmarkReadme, workspaceManifest] = await Promise.all([
      Bun.file("README.md").text(),
      Bun.file("benchmarks/README.md").text(),
      Bun.file("package.json").json() as Promise<{ readonly version: string }>,
    ]);

    const versionedChart = `benchmark-results/elysia-overhead.svg?v=${workspaceManifest.version}`;
    const versionedJson = `benchmark-results/elysia-overhead.json?v=${workspaceManifest.version}`;

    expect(readme).toContain(versionedChart);
    expect(readme).toContain(versionedJson);
    expect(benchmarkReadme).toContain(versionedChart);
    expect(benchmarkReadme).toContain(versionedJson);
    expect(readme).not.toContain("assets/benchmarks/elysia-overhead-editor.svg");
    expect(readme).not.toContain(".ecc/benchmarks/elysia-overhead.json");
    expect(await Bun.file("assets/benchmarks/elysia-overhead-editor.svg").exists()).toBe(false);
    expect(await Bun.file(".ecc/benchmarks/elysia-overhead.json").exists()).toBe(false);
  });
});
