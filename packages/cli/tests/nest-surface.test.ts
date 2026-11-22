import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArguments } from "../src/commands/arguments.ts";
import { runInfoCommand } from "../src/commands/info.ts";
import { runStartCommand } from "../src/commands/start-server.ts";
import { generateProject } from "../src/generation/project-generator.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aponia-surface-"));
  roots.push(root);
  return root;
}

describe("Nest CLI surface", () => {
  test("parses start and info", () => {
    expect(parseArguments(["start", "main.ts", "--watch", "--debug"])).toEqual({
      command: "start",
      entry: "main.ts",
      watch: true,
      debug: true,
      prod: false,
      path: undefined,
      cwd: undefined,
    });
    expect(parseArguments(["info", "--json"])).toEqual({
      command: "info",
      json: true,
      cwd: undefined,
    });
  });

  test("runs the entry through Bun with watch and inspect flags", async () => {
    const root = await temporaryRoot();
    await Bun.write(join(root, "aponia.json"), JSON.stringify({ entryFile: "main" }));
    const spawn = spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(0),
    } as ReturnType<typeof Bun.spawn>);

    try {
      const code = await runStartCommand({
        command: "start",
        entry: "app",
        watch: true,
        debug: true,
        prod: false,
        cwd: root,
      });
      expect(code).toBe(0);
      expect(spawn.mock.calls[0]?.[0]).toEqual(["bun", "--watch", "--inspect", "src/app.ts"]);
    } finally {
      spawn.mockRestore();
    }
  });

  test("reports the workspace as JSON", async () => {
    const root = await temporaryRoot();
    await Bun.write(
      join(root, "aponia.json"),
      JSON.stringify({
        projects: {
          api: {
            type: "application",
            root: "apps/api",
            entryFile: "main",
            sourceRoot: "apps/api/src",
          },
        },
      }),
    );
    await Bun.write(join(root, "package.json"), JSON.stringify({ name: "app", version: "1.0.0" }));
    const log = spyOn(console, "log").mockImplementation(() => {});

    try {
      await runInfoCommand({ command: "info", json: true, cwd: root });
      const payload = JSON.parse(String(log.mock.calls[0]?.[0])) as {
        readonly root: string;
        readonly projects: readonly { readonly name: string; readonly type: string }[];
      };
      expect(payload.root).toBe(root);
      expect(payload.projects[0]).toMatchObject({ name: "api", type: "application" });
    } finally {
      log.mockRestore();
    }
  });

  test("prints the environment as text", async () => {
    const root = await temporaryRoot();
    await Bun.write(
      join(root, "aponia.json"),
      JSON.stringify({
        projects: {
          api: { type: "application", root: "apps/api", sourceRoot: "apps/api/src" },
          widgets: { type: "library", root: "libs/widgets", sourceRoot: "libs/widgets/src" },
        },
      }),
    );
    const log = spyOn(console, "log").mockImplementation(() => {});

    try {
      await runInfoCommand({ command: "info", json: false, cwd: root });
      const lines = log.mock.calls.map((call) => String(call[0]));
      expect(lines.some((line) => line.startsWith("Aponia CLI"))).toBe(true);
      expect(lines.some((line) => line.includes("api"))).toBe(true);
      expect(lines.some((line) => line.includes("widgets"))).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  test("reports an empty directory without a configuration", async () => {
    const root = await temporaryRoot();
    const log = spyOn(console, "log").mockImplementation(() => {});

    try {
      await runInfoCommand({ command: "info", json: false, cwd: root });
      expect(log.mock.calls.some((call) => String(call[0]).includes("Configuration  none"))).toBe(
        true,
      );
    } finally {
      log.mockRestore();
    }
  });

  test("generates a Hono application with the matching dependencies", async () => {
    const root = await temporaryRoot();
    await generateProject({
      name: "hono-api",
      cwd: root,
      platform: "hono",
      skipInstall: true,
      skipSkills: true,
      skipGit: true,
    });
    const manifest = (await Bun.file(join(root, "hono-api", "package.json")).json()) as {
      readonly dependencies: Readonly<Record<string, string>>;
    };

    expect(manifest.dependencies["@aponiajs/platform-hono"]).toBeDefined();
    expect(manifest.dependencies.elysia).toBeUndefined();
    expect(manifest.dependencies["@aponiajs/devtools"]).toBeUndefined();
    expect(await Bun.file(join(root, "hono-api", "src", "main.ts")).text()).toContain(
      "@aponiajs/platform-hono",
    );
  });
});
