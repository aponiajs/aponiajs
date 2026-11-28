import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInfoCommand } from "./info.ts";

/**
 * `aponia info` reads the project it is run in and reports what it found. These
 * cases build a project on disk — a manifest, a configuration naming two
 * projects (one malformed), a lockfile, and a git repository with one commit —
 * so both output forms are asserted against facts rather than a fixture object.
 */

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function projectWith(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(tmpdir(), "aponia-info-"));
  directories.push(directory);
  for (const [path, content] of Object.entries(files)) {
    const target = join(directory, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return directory;
}

function git(root: string, arguments_: readonly string[]): void {
  const result = Bun.spawnSync(["git", ...arguments_], { cwd: root });
  if (result.exitCode !== 0) {
    throw new Error(`git ${arguments_.join(" ")} failed: ${result.stderr.toString()}`);
  }
}

test("reports the manifest, configuration, projects, lockfile, and git state", async () => {
  const root = projectWith({
    "package.json": JSON.stringify({
      dependencies: { "@aponiajs/platform-elysia": "1.0.0" },
      devDependencies: { "vite-plus": "0.5.0" },
      packageManager: "bun@1.4.5",
    }),
    "aponia-cli.json": JSON.stringify({
      projects: {
        api: { type: "application", root: "apps/api" },
        malformed: 1,
      },
    }),
    "bun.lock": "",
  });
  git(root, ["init"]);
  git(root, [
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Test",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  ]);

  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    lines.push(String(message));
  });

  try {
    await runInfoCommand({ command: "info", cwd: root, json: false });
  } finally {
    log.mockRestore();
  }

  const output = lines.join("\n");
  expect(output).toContain("Framework      1.0.0");
  expect(output).toContain("Package managerbun@1.4.5 (bun.lock)");
  expect(output).toContain("Vite+          0.5.0");
  expect(output).toContain("Git            ");
  expect(output).toContain("  api  application  apps/api  apps/api/src");
  expect(output).not.toContain("malformed");
});

test("reports a project that cannot be read as a JSON document", async () => {
  const root = projectWith({
    "package.json": "{ not json",
  });

  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    lines.push(String(message));
  });

  try {
    await runInfoCommand({ command: "info", cwd: root, json: true });
  } finally {
    log.mockRestore();
  }

  const payload = JSON.parse(lines.join("\n")) as {
    framework: string | null;
    configuration: string | null;
    projects: readonly unknown[];
    git: unknown;
  };
  expect(payload.framework).toBeNull();
  expect(payload.configuration).toBeNull();
  expect(payload.projects).toEqual([]);
  expect(payload.git).toBeNull();
});
