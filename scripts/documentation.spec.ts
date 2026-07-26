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
  test("synchronizes every raw benchmark link without changing other content", () => {
    const document = [
      "table: benchmark-results/bun-http-framework-benchmark/results/results.md?v=0.3.17",
      "raw: benchmark-results/bun-http-framework-benchmark/results/bun/aponia.txt?v=0.3.17",
      "environment: benchmark-results/bun-http-framework-benchmark/environment.json?v=0.3.17",
      "",
    ].join("\n");

    expect(updateBenchmarkVersionReferences(document, "0.3.18")).toBe(
      [
        "table: benchmark-results/bun-http-framework-benchmark/results/results.md?v=0.3.18",
        "raw: benchmark-results/bun-http-framework-benchmark/results/bun/aponia.txt?v=0.3.18",
        "environment: benchmark-results/bun-http-framework-benchmark/environment.json?v=0.3.18",
        "",
      ].join("\n"),
    );
  });

  test("uses only versioned raw data from the upstream benchmark", async () => {
    const [readme, benchmarkReadme, workspaceManifest] = await Promise.all([
      Bun.file("README.md").text(),
      Bun.file("benchmarks/README.md").text(),
      Bun.file("package.json").json() as Promise<{ readonly version: string }>,
    ]);

    const artifacts = [
      "bun-http-framework-benchmark/results/results.md",
      "bun-http-framework-benchmark/results/bun/aponia.txt",
      "bun-http-framework-benchmark/environment.json",
    ];
    for (const artifact of artifacts) {
      const versionedReference = `benchmark-results/${artifact}?v=${workspaceManifest.version}`;
      expect(readme).toContain(versionedReference);
      expect(benchmarkReadme).toContain(versionedReference);
    }

    expect(readme).not.toMatch(/\.(?:svg|png|webp)\?v=/);
    expect(benchmarkReadme).not.toMatch(/\.(?:svg|png|webp)\?v=/);
    expect(await Bun.file("benchmarks/elysia-overhead").exists()).toBe(false);
  });
});
