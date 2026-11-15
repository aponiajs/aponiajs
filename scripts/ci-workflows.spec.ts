import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "bun:test";
import { versionedPackageFiles, versionedWorkspacePaths } from "./workspace-versions.ts";

const repositoryRoot = resolve(import.meta.dir, "..");
const packagesDirectory = join(repositoryRoot, "packages");

interface PublishablePackage {
  readonly directory: string;
  readonly name: string;
}

async function listPublishablePackages(): Promise<readonly PublishablePackage[]> {
  const entries = await readdir(packagesDirectory, { withFileTypes: true });
  const packages: PublishablePackage[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifest = (await Bun.file(
      join(packagesDirectory, entry.name, "package.json"),
    ).json()) as {
      readonly name?: unknown;
      readonly private?: unknown;
    };
    if (manifest.private === true) {
      continue;
    }
    if (typeof manifest.name !== "string") {
      throw new Error(`packages/${entry.name}/package.json must declare a package name.`);
    }
    packages.push({ directory: entry.name, name: manifest.name });
  }

  return packages.sort((left, right) => left.directory.localeCompare(right.directory));
}

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

test("every publishable workspace is covered by release, canary, version, and docs", async () => {
  const packages = await listPublishablePackages();
  const directories = packages.map((workspacePackage) => workspacePackage.directory);
  const names = packages.map((workspacePackage) => workspacePackage.name).sort();

  for (const workflowPath of [".github/workflows/publish.yml", ".github/workflows/canary.yml"]) {
    const workflow = await Bun.file(workflowPath).text();
    const packed = [...workflow.matchAll(/bun pm pack --cwd packages\/([a-z0-9-]+)/g)]
      .map((match) => match[1] as string)
      .sort();
    expect(packed, `${workflowPath} must pack every publishable workspace`).toEqual(directories);
  }

  const versionedDirectories = versionedPackageFiles
    .filter((file) => file.startsWith("packages/"))
    .map((file) => file.split("/")[1] as string)
    .sort();
  expect(
    versionedDirectories,
    "versionedPackageFiles must cover every publishable workspace",
  ).toEqual([...directories, "aponiajs"].sort());

  const lockDirectories = [...versionedWorkspacePaths]
    .map((workspacePath) => workspacePath.split("/")[1] as string)
    .sort();
  expect(lockDirectories, "versionedWorkspacePaths must cover every publishable workspace").toEqual(
    [...directories, "aponiajs"].sort(),
  );

  const publishWorkflow = await Bun.file(".github/workflows/publish.yml").text();
  const aliasLine = publishWorkflow.split("\n").find((line) => line.includes("for package in "));
  if (aliasLine === undefined) {
    throw new Error("publish.yml must point alias tags at every package.");
  }
  const aliasNames = aliasLine
    .replace(/^.*for package in /, "")
    .replace(/; do\s*$/, "")
    .trim()
    .split(/\s+/)
    .sort();
  expect(aliasNames, "publish.yml alias tags must cover every publishable package").toEqual(names);

  const packageDocs = await Bun.file("docs/packages.md").text();
  const documented = [...packageDocs.matchAll(/^\|\s*\[?`(@aponiajs\/[^`]+|create-aponia)`/gm)]
    .map((match) => match[1] as string)
    .sort();
  expect(documented, "docs/packages.md must list every publishable package").toEqual(names);
});

test("CI isolates failures while preserving one required verify gate", async () => {
  const workflow = await Bun.file(".github/workflows/ci.yml").text();
  const requiredLanes = [
    "version",
    "quality",
    "bun_tests",
    "macos",
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
  expect(workflow).toMatch(/uses: actions\/dependency-review-action@[0-9a-f]{40}/);
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

test("the documentation site is built and published from the same sources", async () => {
  const workflow = await Bun.file(".github/workflows/docs.yml").text();

  expect(workflow).toContain("bun run docs:build");
  expect(workflow).toMatch(/actions\/upload-pages-artifact@[0-9a-f]{40}/);
  expect(workflow).toContain("path: docs-site");
  expect(workflow).toMatch(/actions\/deploy-pages@[0-9a-f]{40}/);
  expect(workflow).toContain("pages: write");
  expect(workflow).toContain("branches: [main]");
});
