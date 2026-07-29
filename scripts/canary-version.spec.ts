import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stampCanaryVersion } from "./canary-version.ts";
import { versionedPackageFiles, versionedWorkspacePaths } from "./workspace-versions.ts";

const initialWorkingDirectory = process.cwd();
const temporaryDirectories: string[] = [];

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
});

test.serial("stamps every manifest and synchronized release reference", async () => {
  const directory = await createTemporaryDirectory();
  await writeWorkspace(directory, "0.7.0");
  process.chdir(directory);
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    output.push(String(message));
  });

  let version: string;
  try {
    version = await stampCanaryVersion("abc1234def5678", new Date("2026-07-29T03:04:05.000Z"));
  } finally {
    log.mockRestore();
  }

  expect(version).toBe("0.7.0-canary.20260729030405.abc1234");
  for (const file of versionedPackageFiles) {
    const manifest = (await Bun.file(file).json()) as { readonly version: string };
    expect(manifest.version).toBe(version);
  }
  expect(await Bun.file("ROADMAP.md").text()).toContain(`- **Current version:** ${version}`);
  const lockfile = (await Bun.file("bun.lock").json()) as {
    readonly workspaces: Readonly<Record<string, { readonly version: string }>>;
  };
  for (const workspacePath of versionedWorkspacePaths) {
    expect(lockfile.workspaces[workspacePath]?.version).toBe(version);
  }
  expect(output).toEqual([`Synchronized release references for ${version}.`]);
});

test.serial("rejects missing versions and non-stable source channels before writing", async () => {
  const missingVersionDirectory = await createTemporaryDirectory();
  await Bun.write(join(missingVersionDirectory, "package.json"), JSON.stringify({ private: true }));
  process.chdir(missingVersionDirectory);
  expect(stampCanaryVersion("abc1234")).rejects.toThrow("package.json does not declare a version.");

  const prereleaseDirectory = await createTemporaryDirectory();
  await Bun.write(
    join(prereleaseDirectory, "package.json"),
    JSON.stringify({ version: "0.7.0-beta.1" }),
  );
  process.chdir(prereleaseDirectory);
  expect(stampCanaryVersion("abc1234")).rejects.toThrow(
    "Canary versions cannot be derived from the beta channel.",
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aponia-canary-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeWorkspace(directory: string, version: string): Promise<void> {
  for (const file of versionedPackageFiles) {
    const path = join(directory, file);
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, `${JSON.stringify({ name: file, version }, undefined, 2)}\n`);
  }
  await Bun.write(
    join(directory, "ROADMAP.md"),
    `# Roadmap\n\n- **Current version:** ${version}\n`,
  );
  await Bun.write(
    join(directory, "bun.lock"),
    `${JSON.stringify(
      {
        lockfileVersion: 1,
        workspaces: Object.fromEntries(
          versionedWorkspacePaths.map((workspacePath) => [
            workspacePath,
            { name: workspacePath, version },
          ]),
        ),
      },
      undefined,
      2,
    )}\n`,
  );
}
