import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stampCanaryVersionEntry } from "./canary-version.ts";
import { collectExpectedRuntimeSources, runCoverageGateEntry } from "./coverage-gate.ts";
import {
  distributionTags,
  resolveDistribution,
  resolveDistributionEntry,
} from "./distribution-tag.ts";
import { releaseBranchTags, verifyReleaseBranchEntry } from "./release-branch.ts";
import { verifyReleaseEntry } from "./verify-release.ts";
import { versionedPackageFiles, versionedWorkspacePaths } from "./workspace-versions.ts";

/**
 * Each release script exposes the body of its `if (import.meta.main)` block as
 * an exported entry function, and the block itself is one call to that function.
 * The cases below therefore drive the entry functions directly, which is what
 * the coverage lane records, and keep a subprocess case only where the process
 * itself is the contract: the exit code, the process inputs (the arguments,
 * `GITHUB_REF_NAME`, `GITHUB_SHA`, `GITHUB_OUTPUT`, `BASE_VERSION`,
 * `RELEASE_TAG`, `RELEASE_VERSION`, and the working directory), and that the
 * printed verification reaches the terminal instead of a stub logger.
 */
const repositoryRoot = resolve(import.meta.dir, "..");
const coverageReportPath = join(repositoryRoot, "coverage", "lcov.info");
const workspaceVersion = (
  (await Bun.file(join(repositoryRoot, "package.json")).json()) as { readonly version: string }
).version;
const workspaceDistribution = resolveDistribution(workspaceVersion);
const branchTags = new Map<string, string>(Object.entries(releaseBranchTags));
const matchingReleaseBranch =
  Object.entries(releaseBranchTags).find(([, tag]) => tag === workspaceDistribution.tag)?.[0] ?? "";
const mismatchingReleaseBranch =
  Object.entries(releaseBranchTags).find(([, tag]) => tag !== workspaceDistribution.tag)?.[0] ?? "";
const originalCoverageReport = await readCoverageReport();

interface ScriptOptions {
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly unsetEnvironment?: readonly string[];
}

interface ScriptResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

interface LogCollector {
  readonly log: (message: string) => void;
  readonly messages: string[];
}

const temporaryDirectories: string[] = [];
const initialWorkingDirectory = process.cwd();

afterEach(async () => {
  process.chdir(initialWorkingDirectory);
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );

  if (originalCoverageReport !== undefined) {
    await writeCoverageReport(originalCoverageReport);
    return;
  }

  await rm(coverageReportPath, { force: true });
});

/**
 * Runs a script as a process so a case can assert the two things an in-process
 * call cannot show: the exit code and what reaches the terminal.
 */
async function runScript(
  scriptFileName: string,
  scriptArguments: readonly string[] = [],
  options: ScriptOptions = {},
): Promise<ScriptResult> {
  const environment: Record<string, string | undefined> = {
    ...Bun.env,
    ...options.environment,
  };
  for (const name of options.unsetEnvironment ?? []) {
    delete environment[name];
  }

  const subprocess = Bun.spawn(
    [process.execPath, join(repositoryRoot, scriptFileName), ...scriptArguments],
    {
      cwd: options.cwd ?? repositoryRoot,
      env: environment,
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);

  return { exitCode, stderr, stdout };
}

function collectLog(): LogCollector {
  const messages: string[] = [];
  return {
    log: (message: string) => {
      messages.push(message);
    },
    messages,
  };
}

/**
 * Awaits a release script that is expected to fail and returns the error it
 * raised, so a case can assert the structured failure kind — a filesystem code
 * here — instead of incidental message wording.
 */
async function captureFailure(run: () => Promise<unknown>): Promise<{ readonly code?: string }> {
  try {
    await run();
  } catch (error) {
    return error as { readonly code?: string };
  }

  throw new Error("Expected the release script to fail, but it resolved.");
}

/**
 * Runs a release script with `GITHUB_OUTPUT` pointing at the given path, or with
 * the variable removed when no path is given, so this process never appends to
 * the real output file of the runner. The configured value is restored
 * afterwards.
 */
async function withGitHubOutput<T>(
  outputPath: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const configuredOutput = Bun.env.GITHUB_OUTPUT;
  if (outputPath === undefined) {
    delete Bun.env.GITHUB_OUTPUT;
  } else {
    Bun.env.GITHUB_OUTPUT = outputPath;
  }

  try {
    return await run();
  } finally {
    if (configuredOutput === undefined) {
      delete Bun.env.GITHUB_OUTPUT;
    } else {
      Bun.env.GITHUB_OUTPUT = configuredOutput;
    }
  }
}

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeRuntimeSource(directory: string, relativePath: string): Promise<void> {
  const path = join(directory, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, "export const placeholder = true;\n");
}

async function writeCoverageReportAt(
  directory: string,
  sources: readonly string[],
  coveredLines: number,
  foundLines: number,
): Promise<void> {
  const path = join(directory, "coverage", "lcov.info");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, createCoverageReport(sources, coveredLines, foundLines));
}

async function readCoverageReport(): Promise<string | undefined> {
  try {
    return await readFile(coverageReportPath, "utf8");
  } catch {
    return undefined;
  }
}

async function writeCoverageReport(report: string): Promise<void> {
  await mkdir(dirname(coverageReportPath), { recursive: true });
  await writeFile(coverageReportPath, report);
}

function createCoverageReport(
  sources: readonly string[],
  coveredLines: number,
  foundLines: number,
): string {
  return sources
    .map(
      (source) =>
        `SF:${source}\nFNF:1\nFNH:1\nLF:${foundLines}\nLH:${coveredLines}\nend_of_record\n`,
    )
    .join("");
}

async function writeVersionedWorkspace(
  directory: string,
  manifestVersion: string,
  referenceVersion = manifestVersion,
): Promise<void> {
  for (const file of versionedPackageFiles) {
    const path = join(directory, file);
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(
      path,
      `${JSON.stringify({ name: file, version: manifestVersion }, undefined, 2)}\n`,
    );
  }

  await Bun.write(
    join(directory, "ROADMAP.md"),
    `# Roadmap\n\n- **Current version:** ${referenceVersion}\n`,
  );
  await Bun.write(
    join(directory, "bun.lock"),
    `${JSON.stringify(
      {
        lockfileVersion: 1,
        workspaces: Object.fromEntries(
          versionedWorkspacePaths.map((workspacePath) => [
            workspacePath,
            { name: workspacePath, version: referenceVersion },
          ]),
        ),
      },
      undefined,
      2,
    )}\n`,
  );
}

describe("release branch entry point", () => {
  test("verifies a branch against the version in the given manifest", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-branch-");
    const manifestPath = join(directory, "package.json");
    await Bun.write(manifestPath, JSON.stringify({ name: "fixture", version: "1.2.3-beta.4" }));
    const { log, messages } = collectLog();

    const tag = await verifyReleaseBranchEntry({ branch: "release/beta", log, manifestPath });

    expect(tag).toBe("beta");
    expect(messages).toEqual([
      'Verified release branch "release/beta" for distribution tag "beta".',
    ]);
  });

  test("rejects a branch whose channel does not match the workspace version", async () => {
    const { log } = collectLog();
    const mismatchingTag = branchTags.get(mismatchingReleaseBranch);

    expect(mismatchingReleaseBranch).not.toBe("");
    expect(mismatchingTag).not.toBe(workspaceDistribution.tag);
    expect(verifyReleaseBranchEntry({ branch: mismatchingReleaseBranch, log })).rejects.toThrow(
      `Branch "${mismatchingReleaseBranch}" publishes "${mismatchingTag}"`,
    );
  });

  test("rejects a missing branch before it reads any manifest", async () => {
    const { log } = collectLog();

    expect(
      verifyReleaseBranchEntry({
        branch: "",
        log,
        manifestPath: join(import.meta.dir, "missing-package.json"),
      }),
    ).rejects.toThrow("Pass a release branch or set GITHUB_REF_NAME.");
  });

  test("verifies the branch argument as a process and ignores GITHUB_REF_NAME", async () => {
    const result = await runScript("scripts/release-branch.ts", [matchingReleaseBranch], {
      environment: { GITHUB_REF_NAME: mismatchingReleaseBranch },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `Verified release branch "${matchingReleaseBranch}" for distribution tag "${workspaceDistribution.tag}".\n`,
    );
  });

  test("reads GITHUB_REF_NAME as a process when no argument is passed", async () => {
    const result = await runScript("scripts/release-branch.ts", [], {
      environment: { GITHUB_REF_NAME: matchingReleaseBranch },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `Verified release branch "${matchingReleaseBranch}" for distribution tag "${workspaceDistribution.tag}".\n`,
    );
  });

  test("exits non-zero without printing anything when no branch is available", async () => {
    const result = await runScript("scripts/release-branch.ts", [], {
      unsetEnvironment: ["GITHUB_REF_NAME"],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });
});

describe("distribution tag entry point", () => {
  test("resolves a prerelease version argument and reports its alias", async () => {
    const { log, messages } = collectLog();

    const distribution = await withGitHubOutput(undefined, () =>
      resolveDistributionEntry({ log, version: "1.2.3-beta.4" }),
    );

    expect(distribution).toEqual({
      aliases: ["next"],
      tag: "beta",
      version: "1.2.3-beta.4",
    });
    expect(messages).toEqual(['1.2.3-beta.4 publishes to "beta".', "Alias tags: next."]);
  });

  test("resolves a stable version argument without an alias line", async () => {
    const { log, messages } = collectLog();

    const distribution = await withGitHubOutput(undefined, () =>
      resolveDistributionEntry({ log, version: "1.2.3" }),
    );

    expect(distribution.aliases).toEqual([]);
    expect(distribution.tag).toBe("latest");
    expect(messages).toEqual(['1.2.3 publishes to "latest".']);
  });

  test("falls back to the given workspace manifest when no version argument is passed", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-tag-");
    const manifestPath = join(directory, "package.json");
    await Bun.write(manifestPath, JSON.stringify({ name: "fixture", version: "2.0.0-alpha.1" }));
    const { log } = collectLog();

    const distribution = await withGitHubOutput(undefined, () =>
      resolveDistributionEntry({ log, manifestPath }),
    );

    expect(distribution).toEqual({
      aliases: ["next"],
      tag: "alpha",
      version: "2.0.0-alpha.1",
    });
  });

  test("appends the resolved distribution to the existing GitHub output file", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-tag-");
    const outputPath = join(directory, "github-output.txt");
    await Bun.write(outputPath, "previous=value\n");
    const { log } = collectLog();

    await resolveDistributionEntry({ log, outputPath, version: "1.2.3-rc.2" });

    expect(await Bun.file(outputPath).text()).toBe(
      "previous=value\nversion=1.2.3-rc.2\ntag=rc\naliases=next\n",
    );
  });

  test("writes an empty alias list for a version without aliases", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-tag-");
    const outputPath = join(directory, "github-output.txt");
    await Bun.write(outputPath, "");
    const { log } = collectLog();

    await resolveDistributionEntry({ log, outputPath, version: "1.2.3" });

    expect(await Bun.file(outputPath).text()).toBe("version=1.2.3\ntag=latest\naliases=\n");
  });

  test("creates the GitHub output file when the path does not exist yet", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-tag-");
    const outputPath = join(directory, "github-output.txt");
    const { log } = collectLog();

    await resolveDistributionEntry({ log, outputPath, version: "1.2.3-beta.4" });

    expect(await Bun.file(outputPath).text()).toBe(
      "version=1.2.3-beta.4\ntag=beta\naliases=next\n",
    );
  });

  test("creates the file named by GITHUB_OUTPUT when no path is passed", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-tag-");
    const outputPath = join(directory, "github-output.txt");
    const { log } = collectLog();

    const distribution = await withGitHubOutput(outputPath, () =>
      resolveDistributionEntry({ log, version: "1.2.3" }),
    );

    expect(distribution.tag).toBe("latest");
    expect(await Bun.file(outputPath).text()).toBe("version=1.2.3\ntag=latest\naliases=\n");
  });

  test("resolves without a GitHub output file when GITHUB_OUTPUT is unset", async () => {
    const { log, messages } = collectLog();

    const distribution = await withGitHubOutput(undefined, () =>
      resolveDistributionEntry({ log, version: "1.2.3-rc.2" }),
    );

    expect(distribution).toEqual({ aliases: ["next"], tag: "rc", version: "1.2.3-rc.2" });
    expect(messages).toEqual(['1.2.3-rc.2 publishes to "rc".', "Alias tags: next."]);
  });

  test("fails when the directory of the GitHub output file does not exist", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-tag-");
    const outputPath = join(directory, "missing", "github-output.txt");
    const { log } = collectLog();

    const failure = await captureFailure(() =>
      resolveDistributionEntry({ log, outputPath, version: "1.2.3" }),
    );

    expect(failure.code).toBe("ENOENT");
    expect(await Bun.file(outputPath).exists()).toBe(false);
  });

  test("rejects an invalid version before it touches the GitHub output file", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-tag-");
    const outputPath = join(directory, "github-output.txt");
    await Bun.write(outputPath, "previous=value\n");
    const { log } = collectLog();

    expect(resolveDistributionEntry({ log, outputPath, version: "1.2" })).rejects.toThrow(
      "1.2 is not a valid SemVer version.",
    );
    expect(await Bun.file(outputPath).text()).toBe("previous=value\n");
  });

  test("publishes a version argument to the terminal as a process", async () => {
    const result = await runScript("scripts/distribution-tag.ts", ["1.2.3-alpha.4"], {
      unsetEnvironment: ["GITHUB_OUTPUT"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('1.2.3-alpha.4 publishes to "alpha".\nAlias tags: next.\n');
  });

  test("reads the workspace manifest of the working directory as a process", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-tag-");
    await Bun.write(
      join(directory, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.5.0-rc.1" }),
    );

    const result = await runScript("scripts/distribution-tag.ts", [], {
      cwd: directory,
      unsetEnvironment: ["GITHUB_OUTPUT"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('1.5.0-rc.1 publishes to "rc".\nAlias tags: next.\n');
  });

  test("exits non-zero without printing anything for an invalid version argument", async () => {
    const result = await runScript("scripts/distribution-tag.ts", ["1.2"], {
      unsetEnvironment: ["GITHUB_OUTPUT"],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });
});

describe("canary version entry point", () => {
  // The canary stamp carries the instant of the run, so the process cases match
  // the shape with a backreference proving both lines share one stamp.
  const canaryStdoutPattern =
    /^Synchronized release references for (0\.7\.0-canary\.\d{14}\.abc1234)\.\nStamped canary version \1\.\n$/;

  test.serial("stamps the workspace and records the GitHub output", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-canary-");
    await writeVersionedWorkspace(directory, "0.7.0");
    const outputPath = join(directory, "github-output.txt");
    await Bun.write(outputPath, "previous=value\n");
    process.chdir(directory);
    const output: string[] = [];
    const consoleSpy = spyOn(console, "log").mockImplementation((message) => {
      output.push(String(message));
    });

    let canaryVersion: string;
    try {
      canaryVersion = await stampCanaryVersionEntry({
        commitSha: "abc1234def5678",
        date: new Date("2026-07-29T03:04:05.000Z"),
        outputPath,
      });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(canaryVersion).toBe("0.7.0-canary.20260729030405.abc1234");
    expect(output).toEqual([
      `Synchronized release references for ${canaryVersion}.`,
      `Stamped canary version ${canaryVersion}.`,
    ]);
    expect(await Bun.file(outputPath).text()).toBe(`previous=value\nversion=${canaryVersion}\n`);
    for (const file of versionedPackageFiles) {
      const manifest = (await Bun.file(join(directory, file)).json()) as {
        readonly version: string;
      };
      expect(manifest.version).toBe(canaryVersion);
    }
    expect(await Bun.file(join(directory, "ROADMAP.md")).text()).toContain(
      `- **Current version:** ${canaryVersion}`,
    );
  });

  test.serial("creates the GitHub output file when the path does not exist yet", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-canary-");
    await writeVersionedWorkspace(directory, "0.7.0");
    const outputPath = join(directory, "github-output.txt");
    process.chdir(directory);
    const { log } = collectLog();

    const canaryVersion = await stampCanaryVersionEntry({
      commitSha: "abc1234def5678",
      date: new Date("2026-07-29T03:04:05.000Z"),
      log,
      outputPath,
    });

    expect(canaryVersion).toBe("0.7.0-canary.20260729030405.abc1234");
    expect(await Bun.file(outputPath).text()).toBe(`version=${canaryVersion}\n`);
  });

  test.serial("fails when the directory of the GitHub output file does not exist", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-canary-");
    await writeVersionedWorkspace(directory, "0.7.0");
    const outputPath = join(directory, "missing", "github-output.txt");
    process.chdir(directory);
    const { log } = collectLog();

    const failure = await captureFailure(() =>
      stampCanaryVersionEntry({
        commitSha: "abc1234def5678",
        date: new Date("2026-07-29T03:04:05.000Z"),
        log,
        outputPath,
      }),
    );

    expect(failure.code).toBe("ENOENT");
    expect(await Bun.file(outputPath).exists()).toBe(false);
  });

  test.serial("returns the stamped version without writing a GitHub output file", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-canary-");
    await writeVersionedWorkspace(directory, "0.7.0");
    process.chdir(directory);
    const { log, messages } = collectLog();
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    let canaryVersion: string;
    try {
      canaryVersion = await withGitHubOutput(undefined, () =>
        stampCanaryVersionEntry({
          commitSha: "abc1234def5678",
          date: new Date("2026-07-29T03:04:05.000Z"),
          log,
        }),
      );
    } finally {
      consoleSpy.mockRestore();
    }

    expect(canaryVersion).toBe("0.7.0-canary.20260729030405.abc1234");
    expect(messages).toEqual([`Stamped canary version ${canaryVersion}.`]);
    expect(await Bun.file(join(directory, "github-output.txt")).exists()).toBe(false);
  });

  test.serial("rejects a missing commit SHA and leaves the workspace untouched", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-canary-");
    await writeVersionedWorkspace(directory, "0.7.0");
    const outputPath = join(directory, "github-output.txt");
    await Bun.write(outputPath, "previous=value\n");
    process.chdir(directory);

    expect(stampCanaryVersionEntry({ commitSha: "", outputPath })).rejects.toThrow(
      "Pass a commit SHA or set GITHUB_SHA before stamping a canary version.",
    );

    const manifest = (await Bun.file(join(directory, "package.json")).json()) as {
      readonly version: string;
    };
    expect(manifest.version).toBe("0.7.0");
    expect(await Bun.file(outputPath).text()).toBe("previous=value\n");
  });

  test("stamps a workspace from the commit argument as a process", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-canary-");
    await writeVersionedWorkspace(directory, "0.7.0");

    const result = await runScript("scripts/canary-version.ts", ["abc1234def5678"], {
      cwd: directory,
      unsetEnvironment: ["GITHUB_OUTPUT", "GITHUB_SHA"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(canaryStdoutPattern);
  });

  test("reads the commit SHA from GITHUB_SHA as a process", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-canary-");
    await writeVersionedWorkspace(directory, "0.7.0");

    const result = await runScript("scripts/canary-version.ts", [], {
      cwd: directory,
      environment: { GITHUB_SHA: "abc1234def5678" },
      unsetEnvironment: ["GITHUB_OUTPUT"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(canaryStdoutPattern);
  });

  test("exits non-zero without printing anything when no commit SHA is available", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-canary-");
    await writeVersionedWorkspace(directory, "0.7.0");

    const result = await runScript("scripts/canary-version.ts", [], {
      cwd: directory,
      unsetEnvironment: ["GITHUB_OUTPUT", "GITHUB_SHA"],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });
});

describe("synchronize version references entry point", () => {
  test("rewrites the stale roadmap and lockfile references as a process", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-sync-");
    await writeVersionedWorkspace(directory, "0.7.0", "0.6.0");

    const result = await runScript("scripts/sync-version-references.ts", [], { cwd: directory });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Synchronized release references for 0.7.0.\n");
  });
});

describe("aggregate coverage gate entry point", () => {
  test("verifies a complete report from the given workspace root", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-coverage-");
    await writeRuntimeSource(directory, "packages/common/src/index.ts");
    await writeCoverageReportAt(directory, ["packages/common/src/index.ts"], 10, 10);
    const { log, messages } = collectLog();

    const summary = await runCoverageGateEntry({ log, workspaceRoot: directory });

    expect(summary.lines).toEqual({ covered: 10, found: 10, ratio: 1 });
    expect(summary.functions).toEqual({ covered: 1, found: 1, ratio: 1 });
    expect(summary.sources).toEqual(new Set(["packages/common/src/index.ts"]));
    expect(messages).toEqual(["Verified aggregate coverage: 100.00% lines, 100.00% functions."]);
  });

  test("fails when the report omits a runtime source of the workspace", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-coverage-");
    await writeRuntimeSource(directory, "packages/common/src/index.ts");
    await writeRuntimeSource(directory, "scripts/distribution-tag.ts");
    await writeCoverageReportAt(directory, ["scripts/distribution-tag.ts"], 10, 10);
    const { log } = collectLog();

    expect(runCoverageGateEntry({ log, workspaceRoot: directory })).rejects.toThrow(
      "packages/common/src/index.ts",
    );
  });

  test("fails when the aggregate line ratio is below the threshold", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-coverage-");
    await writeRuntimeSource(directory, "packages/common/src/index.ts");
    await writeCoverageReportAt(directory, ["packages/common/src/index.ts"], 9, 10);
    const { log } = collectLog();

    expect(runCoverageGateEntry({ log, workspaceRoot: directory })).rejects.toThrow(
      "Coverage threshold failed: line: 90.00% < 95.00%.",
    );
  });

  test("fails when the coverage lane has not written a report yet", async () => {
    const directory = await createTemporaryDirectory("aponia-entry-coverage-");
    await writeRuntimeSource(directory, "packages/common/src/index.ts");
    const { log } = collectLog();

    expect(runCoverageGateEntry({ log, workspaceRoot: directory })).rejects.toThrow("lcov.info");
  });

  test("verifies the report written by the coverage lane as a process", async () => {
    const sources = await collectExpectedRuntimeSources(repositoryRoot);
    await writeCoverageReport(createCoverageReport(sources, 10, 10));

    const result = await runScript("scripts/coverage-gate.ts");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Verified aggregate coverage: 100.00% lines, 100.00% functions.\n");
  });
});

describe("release verification entry point", () => {
  const verifiedLines = [
    `Verified synchronized release version ${workspaceVersion}.`,
    workspaceDistribution.aliases.length > 0
      ? `Distribution tag: ${workspaceDistribution.tag} (alias: ${workspaceDistribution.aliases.join(", ")}).`
      : `Distribution tag: ${workspaceDistribution.tag}.`,
  ];
  const verifiedOutput = `${verifiedLines.join("\n")}\n`;

  test("verifies the workspace with explicit release variables", async () => {
    const { log, messages } = collectLog();

    await verifyReleaseEntry({
      baseVersion: "0.0.0",
      log,
      releaseTag: workspaceDistribution.tag,
      releaseVersion: `v${workspaceVersion}`,
    });

    expect(messages).toEqual(verifiedLines);
  });

  test("rejects a release version that does not match the workspace version", async () => {
    const { log } = collectLog();

    expect(
      verifyReleaseEntry({ baseVersion: "", log, releaseTag: "", releaseVersion: "v9.9.9" }),
    ).rejects.toThrow("Release version 9.9.9 does not match workspace version");
  });

  test("rejects a release tag the workspace version cannot publish", async () => {
    const forbiddenTag =
      distributionTags.find(
        (tag) => tag !== workspaceDistribution.tag && !workspaceDistribution.aliases.includes(tag),
      ) ?? "";
    const { log } = collectLog();

    expect(forbiddenTag).not.toBe("");
    expect(
      verifyReleaseEntry({ baseVersion: "", log, releaseTag: forbiddenTag, releaseVersion: "" }),
    ).rejects.toThrow("may only be published under");
  });

  test("rejects a base version the workspace version did not increase past", async () => {
    const { log } = collectLog();

    expect(
      verifyReleaseEntry({
        baseVersion: workspaceVersion,
        log,
        releaseTag: "",
        releaseVersion: "",
      }),
    ).rejects.toThrow("Workspace version must increase on every push");
  });

  test("verifies the workspace without release variables as a process", async () => {
    const result = await runScript("scripts/verify-release.ts", [], {
      unsetEnvironment: ["BASE_VERSION", "RELEASE_TAG", "RELEASE_VERSION"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(verifiedOutput);
  });

  test("reads BASE_VERSION, RELEASE_TAG, and RELEASE_VERSION as a process", async () => {
    const result = await runScript("scripts/verify-release.ts", [], {
      environment: {
        BASE_VERSION: "0.0.0",
        RELEASE_TAG: workspaceDistribution.tag,
        RELEASE_VERSION: `v${workspaceVersion}`,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(verifiedOutput);
  });

  test("exits non-zero without printing anything when RELEASE_VERSION does not match", async () => {
    const result = await runScript("scripts/verify-release.ts", [], {
      environment: { RELEASE_VERSION: "v9.9.9" },
      unsetEnvironment: ["BASE_VERSION", "RELEASE_TAG"],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });
});
