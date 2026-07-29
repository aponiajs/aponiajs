import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synchronizeVersionReferences } from "./sync-version-references.ts";
import { versionedWorkspacePaths } from "./workspace-versions.ts";

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

test.serial("synchronizes the roadmap and Bun lockfile from a manifest", async () => {
  const directory = await createTemporaryDirectory();
  const manifestPath = join(directory, "package.json");
  const roadmapPath = join(directory, "ROADMAP.md");
  const lockfilePath = join(directory, "bun.lock");
  await Bun.write(manifestPath, JSON.stringify({ version: "0.7.0-alpha.1" }));
  await Bun.write(roadmapPath, "- **Current version:** 0.6.0-alpha.1\n");
  await Bun.write(lockfilePath, lockfileFixture("0.6.0-alpha.1"));
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    output.push(String(message));
  });

  try {
    await synchronizeVersionReferences(manifestPath, roadmapPath, lockfilePath);
  } finally {
    log.mockRestore();
  }

  expect(await Bun.file(roadmapPath).text()).toBe("- **Current version:** 0.7.0-alpha.1\n");
  const lockfile = (await Bun.file(lockfilePath).json()) as {
    readonly workspaces: Readonly<Record<string, { readonly version: string }>>;
  };
  for (const workspacePath of versionedWorkspacePaths) {
    expect(lockfile.workspaces[workspacePath]?.version).toBe("0.7.0-alpha.1");
  }
  expect(output).toEqual(["Synchronized release references for 0.7.0-alpha.1."]);
});

test("rejects a manifest without a string version", async () => {
  const directory = await createTemporaryDirectory();
  const manifestPath = join(directory, "package.json");
  await Bun.write(manifestPath, JSON.stringify({ version: 7 }));

  expect(
    synchronizeVersionReferences(
      manifestPath,
      join(directory, "ROADMAP.md"),
      join(directory, "bun.lock"),
    ),
  ).rejects.toThrow(`${manifestPath} does not declare a version.`);
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aponia-sync-versions-"));
  temporaryDirectories.push(directory);
  return directory;
}

function lockfileFixture(version: string): string {
  return `${JSON.stringify(
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
  )}\n`;
}
