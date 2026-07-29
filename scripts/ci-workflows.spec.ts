import { expect, test } from "bun:test";

const releaseGateCommands = [
  "bun run check",
  "bun run test:coverage",
  "bun run test:examples",
  "bun run test:vite-plus",
  "bun run build",
  "bun run test:generated-app",
] as const;

test("every publish path runs the complete validation matrix", async () => {
  const workflowPaths = [
    ".github/workflows/ci.yml",
    ".github/workflows/publish.yml",
    ".github/workflows/canary.yml",
  ] as const;

  for (const path of workflowPaths) {
    const workflow = await Bun.file(path).text();
    for (const command of releaseGateCommands) {
      expect(workflow, `${path} must run ${command}`).toContain(command);
    }
  }
});

test("coverage tooling protects both line and function regressions", async () => {
  const configuration = await Bun.file("bunfig.toml").text();
  const manifest = (await Bun.file("package.json").json()) as {
    readonly scripts: Readonly<Record<string, string>>;
  };

  expect(configuration).toContain("coverageSkipTestFiles = true");
  expect(manifest.scripts["test:coverage"]).toContain("scripts/coverage-gate.ts");
});
