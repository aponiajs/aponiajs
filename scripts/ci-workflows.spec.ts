import { expect, test } from "bun:test";

const releaseGateCommands = [
  "bun run check",
  "bun run test:coverage",
  "bun run test:examples",
  "bun run test:vite-plus",
  "bun run build",
  "bun run test:generated-app",
  "bun run release:dry-run",
  "bun audit --audit-level=high",
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

test("CI isolates failures while preserving one required verify gate", async () => {
  const workflow = await Bun.file(".github/workflows/ci.yml").text();
  const requiredLanes = [
    "version",
    "quality",
    "bun_tests",
    "conformance",
    "integration",
    "packaging",
    "security",
  ] as const;

  for (const lane of requiredLanes) {
    expect(workflow).toContain(`  ${lane}:`);
    expect(workflow).toContain(`      - ${lane}`);
    expect(workflow).toContain(`needs.${lane}.result`);
  }

  expect(workflow).toContain("  verify:");
  expect(workflow).toContain("if: always()");
  expect(workflow).toContain("needs:\n      - version");
  expect(workflow).toContain("uses: actions/dependency-review-action@v5");
  expect(workflow).toContain("if: github.event_name == 'pull_request'");
  expect(workflow).toContain("fail-on-severity: high");
});

test("coverage tooling protects both line and function regressions", async () => {
  const configuration = await Bun.file("bunfig.toml").text();
  const manifest = (await Bun.file("package.json").json()) as {
    readonly scripts: Readonly<Record<string, string>>;
  };

  expect(configuration).toContain("coverageSkipTestFiles = true");
  expect(manifest.scripts["test:coverage"]).toContain("scripts/coverage-gate.ts");
});
