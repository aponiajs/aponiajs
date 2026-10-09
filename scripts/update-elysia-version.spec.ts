import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  collectTargetFiles,
  defaultSpawnRunner,
  elysiaTargetFiles,
  fetchLatestNpmDistTag,
  resolveCurrentEdenVersion,
  resolveCurrentElysiaVersion,
  updateElysiaVersion,
  updateElysiaVersionEntry,
} from "./update-elysia-version.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aponia-elysia-test-"));
  temporaryDirectories.push(dir);
  return dir;
}

describe("update-elysia-version", () => {
  test("collectTargetFiles includes known target files", async () => {
    const root = resolve(import.meta.dir, "..");
    const files = await collectTargetFiles(root);

    for (const known of elysiaTargetFiles) {
      expect(files).toContain(known);
    }
  });

  test("resolveCurrentElysiaVersion reads elysia from platform-elysia manifest", async () => {
    const root = resolve(import.meta.dir, "..");
    const version = await resolveCurrentElysiaVersion(root);
    expect(version).toBe("2.0.0-beta.24");
  });

  test("resolveCurrentElysiaVersion throws when platform manifest is missing", async () => {
    const dir = await createTempWorkspace();
    expect(resolveCurrentElysiaVersion(dir)).rejects.toThrow("Cannot find platform manifest");
  });

  test("resolveCurrentElysiaVersion throws when elysia peer dependency is missing", async () => {
    const dir = await createTempWorkspace();
    const manifestDir = join(dir, "packages/platform-elysia");
    await mkdir(manifestDir, { recursive: true });
    await Bun.write(join(manifestDir, "package.json"), JSON.stringify({ peerDependencies: {} }));

    expect(resolveCurrentElysiaVersion(dir)).rejects.toThrow(
      "does not declare a peerDependency for elysia",
    );
  });

  test("resolveCurrentEdenVersion reads @elysia/eden version or returns undefined", async () => {
    const root = resolve(import.meta.dir, "..");
    const edenVersion = await resolveCurrentEdenVersion(root);
    expect(edenVersion).toBe("2.0.0-beta.6");

    const dir = await createTempWorkspace();
    expect(await resolveCurrentEdenVersion(dir)).toBeUndefined();
  });

  test("fetchLatestNpmDistTag resolves dist-tag from npm", async () => {
    const nextTag = await fetchLatestNpmDistTag("elysia", true);
    expect(typeof nextTag).toBe("string");
    expect(nextTag.length).toBeGreaterThan(0);

    const latestTag = await fetchLatestNpmDistTag("elysia", false);
    expect(typeof latestTag).toBe("string");
    expect(latestTag.length).toBeGreaterThan(0);
  });

  test("fetchLatestNpmDistTag throws on non-existent package", async () => {
    expect(
      fetchLatestNpmDistTag("a-non-existent-package-name-aponia-test-12345"),
    ).rejects.toThrow();
  });

  test("fetchLatestNpmDistTag throws when dist-tags is missing or unresolvable", async () => {
    const mockFetcherMissingTags = async () => new Response(JSON.stringify({}), { status: 200 });

    expect(
      fetchLatestNpmDistTag("test-pkg", false, mockFetcherMissingTags as unknown as typeof fetch),
    ).rejects.toThrow("No dist-tags found");

    const mockFetcherNoMatchingTags = async () =>
      new Response(JSON.stringify({ "dist-tags": { other: "1.0.0" } }), { status: 200 });

    expect(
      fetchLatestNpmDistTag(
        "test-pkg",
        false,
        mockFetcherNoMatchingTags as unknown as typeof fetch,
      ),
    ).rejects.toThrow("Could not resolve tag");
  });

  test("defaultSpawnRunner executes bun command", () => {
    const result = defaultSpawnRunner(["bun", "--version"], { cwd: process.cwd() });
    expect(result.exitCode).toBe(0);
  });

  test("updateElysiaVersion updates files in workspace when version differs", async () => {
    const dir = await createTempWorkspace();
    const messages: string[] = [];

    const platformDir = join(dir, "packages/platform-elysia");
    await mkdir(platformDir, { recursive: true });
    await Bun.write(
      join(platformDir, "package.json"),
      JSON.stringify({
        peerDependencies: { elysia: "2.0.0-beta.20" },
        devDependencies: { "@elysia/eden": "2.0.0-beta.3" },
      }),
    );

    const docsDir = join(dir, "docs");
    await mkdir(docsDir, { recursive: true });
    await Bun.write(
      join(docsDir, "elysia-compatibility.md"),
      'The version is "elysia": "2.0.0-beta.20" and ^2.0.0-beta.20.',
    );

    const result = await updateElysiaVersion({
      workspaceRoot: dir,
      currentVersion: "2.0.0-beta.20",
      targetVersion: "2.0.0-beta.24",
      edenVersion: "2.0.0-beta.6",
      runInstall: false,
      log: (msg) => messages.push(msg),
    });

    expect(result.currentVersion).toBe("2.0.0-beta.20");
    expect(result.targetVersion).toBe("2.0.0-beta.24");
    expect(result.edenUpdated).toBe(true);
    expect(result.updatedFiles).toContain("packages/platform-elysia/package.json");
    expect(result.updatedFiles).toContain("docs/elysia-compatibility.md");

    const updatedDoc = await Bun.file(join(docsDir, "elysia-compatibility.md")).text();
    expect(updatedDoc).toContain('"elysia": "2.0.0-beta.24"');
    expect(updatedDoc).toContain("^2.0.0-beta.24");

    const updatedManifest = await Bun.file(join(platformDir, "package.json")).text();
    expect(updatedManifest).toContain("2.0.0-beta.24");
    expect(updatedManifest).toContain("2.0.0-beta.6");
  });

  test("updateElysiaVersion returns early when targetVersion is identical and no edenVersion", async () => {
    const dir = await createTempWorkspace();
    const messages: string[] = [];

    const result = await updateElysiaVersion({
      workspaceRoot: dir,
      currentVersion: "2.0.0-beta.24",
      targetVersion: "2.0.0-beta.24",
      runInstall: false,
      log: (msg) => messages.push(msg),
    });

    expect(result.updatedFiles.length).toBe(0);
    expect(messages.some((msg) => msg.includes("already at 2.0.0-beta.24"))).toBe(true);
  });

  test("updateElysiaVersionEntry handles --help flag", async () => {
    const messages: string[] = [];
    const result = await updateElysiaVersionEntry({
      args: ["--help"],
      log: (msg) => messages.push(msg),
    });

    expect(result.updatedFiles.length).toBe(0);
    expect(messages.some((msg) => msg.includes("Usage:"))).toBe(true);
  });

  test("updateElysiaVersionEntry runs with explicit target and --no-install", async () => {
    const dir = await createTempWorkspace();
    const platformDir = join(dir, "packages/platform-elysia");
    await mkdir(platformDir, { recursive: true });
    await Bun.write(
      join(platformDir, "package.json"),
      JSON.stringify({
        peerDependencies: { elysia: "2.0.0-beta.20" },
      }),
    );

    const messages: string[] = [];
    const result = await updateElysiaVersionEntry({
      args: ["2.0.0-beta.24", "--no-install"],
      workspaceRoot: dir,
      log: (msg) => messages.push(msg),
    });

    expect(result.targetVersion).toBe("2.0.0-beta.24");
    expect(result.updatedFiles.length).toBe(1);
  });

  test("updateElysiaVersionEntry automatically queries npm tag when no target is passed", async () => {
    const dir = await createTempWorkspace();
    const platformDir = join(dir, "packages/platform-elysia");
    await mkdir(platformDir, { recursive: true });
    await Bun.write(
      join(platformDir, "package.json"),
      JSON.stringify({
        peerDependencies: { elysia: "2.0.0-beta.20" },
      }),
    );

    const messages: string[] = [];
    const result = await updateElysiaVersionEntry({
      args: ["--no-install"],
      workspaceRoot: dir,
      log: (msg) => messages.push(msg),
    });

    expect(typeof result.targetVersion).toBe("string");
    expect(result.targetVersion.length).toBeGreaterThan(0);
    expect(messages.some((msg) => msg.includes("Querying npm"))).toBe(true);
  });

  test("updateElysiaVersion throws when bun install fails", async () => {
    const dir = await createTempWorkspace();
    const platformDir = join(dir, "packages/platform-elysia");
    await mkdir(platformDir, { recursive: true });
    await Bun.write(
      join(platformDir, "package.json"),
      JSON.stringify({
        peerDependencies: { elysia: "2.0.0-beta.20" },
      }),
    );

    expect(
      updateElysiaVersion({
        workspaceRoot: dir,
        currentVersion: "2.0.0-beta.20",
        targetVersion: "2.0.0-beta.24",
        runInstall: true,
        spawnSync: () => ({ exitCode: 1 }),
        log: () => {},
      }),
    ).rejects.toThrow("bun install failed with exit code 1");
  });

  test("updateElysiaVersion succeeds with runInstall and runs sync script", async () => {
    const dir = await createTempWorkspace();
    const platformDir = join(dir, "packages/platform-elysia");
    await mkdir(platformDir, { recursive: true });
    await Bun.write(
      join(platformDir, "package.json"),
      JSON.stringify({
        peerDependencies: { elysia: "2.0.0-beta.20" },
      }),
    );

    const scriptsDir = join(dir, "scripts");
    await mkdir(scriptsDir, { recursive: true });
    await Bun.write(join(scriptsDir, "sync-version-references.ts"), "console.log('sync');");

    const commands: string[][] = [];
    const result = await updateElysiaVersion({
      workspaceRoot: dir,
      currentVersion: "2.0.0-beta.20",
      targetVersion: "2.0.0-beta.24",
      runInstall: true,
      spawnSync: (args) => {
        commands.push([...args]);
        return { exitCode: 0 };
      },
      log: () => {},
    });

    expect(result.updatedFiles.length).toBe(1);
    expect(commands).toEqual([
      ["bun", "install"],
      ["bun", resolve(dir, "scripts/sync-version-references.ts")],
    ]);
  });

  test("updateElysiaVersionEntry handles --eden flag and positional argument", async () => {
    const dir = await createTempWorkspace();
    const platformDir = join(dir, "packages/platform-elysia");
    await mkdir(platformDir, { recursive: true });
    await Bun.write(
      join(platformDir, "package.json"),
      JSON.stringify({
        peerDependencies: { elysia: "2.0.0-beta.20" },
        devDependencies: { "@elysia/eden": "2.0.0-beta.3" },
      }),
    );

    const result = await updateElysiaVersionEntry({
      args: ["2.0.0-beta.24", "--eden", "2.0.0-beta.6", "--no-install"],
      workspaceRoot: dir,
      log: () => {},
    });

    expect(result.targetVersion).toBe("2.0.0-beta.24");
    expect(result.edenUpdated).toBe(true);
    expect(result.updatedFiles).toContain("packages/platform-elysia/package.json");
  });

  test("invokes CLI entrypoint as a subprocess", () => {
    const scriptPath = resolve(import.meta.dir, "update-elysia-version.ts");
    const proc = Bun.spawnSync(["bun", scriptPath, "--help"]);

    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain("Usage:");
  });
});
