import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyRelease } from "./verify-release.ts";
import { versionedWorkspacePaths } from "./workspace-versions.ts";

const currentVersion = ((await Bun.file("package.json").json()) as { version: string }).version;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

function verifyWithBaseVersion(baseVersion: string) {
  return Bun.spawnSync({
    cmd: ["bun", "scripts/verify-release.ts"],
    env: {
      ...Bun.env,
      BASE_VERSION: baseVersion,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
}

describe("release version gate", () => {
  test("validates the current workspace through the testable release contract", async () => {
    const output: string[] = [];

    await verifyRelease({
      baseVersion: "0.0.0",
      releaseTag: "alpha",
      releaseVersion: currentVersion,
      log: (message) => output.push(message),
    });

    expect(output).toEqual([
      `Verified synchronized release version ${currentVersion}.`,
      "Distribution tag: alpha (alias: next).",
    ]);
  });

  test("rejects invalid expected versions and release tags", async () => {
    expect(
      verifyRelease({
        releaseVersion: "v9.9.9",
        log: () => {},
      }),
    ).rejects.toThrow("Release version 9.9.9 does not match workspace version");
    expect(
      verifyRelease({
        releaseTag: "latest",
        log: () => {},
      }),
    ).rejects.toThrow("may only be published under: alpha, next");
    expect(
      verifyRelease({
        baseVersion: "not-semver",
        log: () => {},
      }),
    ).rejects.toThrow("not-semver is not a valid base SemVer version.");
  });

  test("rejects missing, unsynchronized, and invalid manifest versions", async () => {
    const missing = await createReleaseFixture([undefined, "1.2.3"], "1.2.3");
    expect(
      verifyRelease({
        packageFiles: missing.packageFiles,
        lockfilePath: missing.lockfilePath,
        log: () => {},
      }),
    ).rejects.toThrow(`${missing.packageFiles[0]} does not declare a version.`);

    const unsynchronized = await createReleaseFixture(["1.2.3", "1.2.4"], "1.2.3");
    expect(
      verifyRelease({
        packageFiles: unsynchronized.packageFiles,
        lockfilePath: unsynchronized.lockfilePath,
        log: () => {},
      }),
    ).rejects.toThrow("Workspace versions are not synchronized:");

    const invalid = await createReleaseFixture(["invalid", "invalid"], "invalid");
    expect(
      verifyRelease({
        packageFiles: invalid.packageFiles,
        lockfilePath: invalid.lockfilePath,
        log: () => {},
      }),
    ).rejects.toThrow("invalid is not a valid SemVer version.");
  });

  test("accepts a stable release and rejects a non-increasing base version", async () => {
    const fixture = await createReleaseFixture(["1.2.3", "1.2.3"], "1.2.3");
    const output: string[] = [];
    await verifyRelease({
      packageFiles: fixture.packageFiles,
      lockfilePath: fixture.lockfilePath,
      releaseTag: "latest",
      releaseVersion: "v1.2.3",
      baseVersion: "1.2.2",
      log: (message) => output.push(message),
    });

    expect(output).toEqual([
      "Verified synchronized release version 1.2.3.",
      "Distribution tag: latest.",
    ]);
    expect(
      verifyRelease({
        packageFiles: fixture.packageFiles,
        lockfilePath: fixture.lockfilePath,
        baseVersion: "1.2.3",
        log: () => {},
      }),
    ).rejects.toThrow("Workspace version must increase on every push: 1.2.3 -> 1.2.3.");
  });

  test("accepts a greater synchronized version", () => {
    const result = verifyWithBaseVersion("0.0.0");

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(
      `Verified synchronized release version ${currentVersion}.`,
    );
  });

  test("rejects an unchanged version", () => {
    const result = verifyWithBaseVersion(currentVersion);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Workspace version must increase on every push");
  });
});

async function createReleaseFixture(
  versions: readonly (string | undefined)[],
  lockfileVersion: string,
): Promise<{
  readonly lockfilePath: string;
  readonly packageFiles: readonly string[];
}> {
  const directory = await mkdtemp(join(tmpdir(), "aponia-verify-release-"));
  temporaryDirectories.push(directory);
  const packageFiles = await Promise.all(
    versions.map(async (version, index) => {
      const path = join(directory, `package-${index}.json`);
      await Bun.write(path, JSON.stringify(version ? { version } : { private: true }));
      return path;
    }),
  );
  const lockfilePath = join(directory, "bun.lock");
  await Bun.write(
    lockfilePath,
    JSON.stringify({
      workspaces: Object.fromEntries(
        versionedWorkspacePaths.map((workspacePath) => [
          workspacePath,
          { version: lockfileVersion },
        ]),
      ),
    }),
  );

  return { lockfilePath, packageFiles };
}
