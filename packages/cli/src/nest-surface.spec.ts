import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArguments } from "./commands/arguments.ts";
import { runInfoCommand } from "./commands/info.ts";
import { runStartCommand } from "./commands/start-server.ts";
import { generateProject } from "./generation/project-generator.ts";

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

  test("starts from the defaults without a configuration file", async () => {
    const root = await temporaryRoot();
    const spawn = spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(0),
    } as ReturnType<typeof Bun.spawn>);

    try {
      const code = await runStartCommand({
        command: "start",
        watch: false,
        debug: false,
        prod: false,
        cwd: root,
      });
      expect(code).toBe(0);
      expect(spawn.mock.calls[0]?.[0]).toEqual(["bun", "src/main.ts"]);
      expect(spawn.mock.calls[0]?.[1]).toMatchObject({ cwd: root });
    } finally {
      spawn.mockRestore();
    }
  });

  test("starts a configured project by name", async () => {
    const root = await temporaryRoot();
    await Bun.write(
      join(root, "aponia-cli.json"),
      JSON.stringify({
        sourceRoot: "src",
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
    const spawn = spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(0),
    } as ReturnType<typeof Bun.spawn>);

    try {
      const code = await runStartCommand({
        command: "start",
        entry: "api",
        watch: false,
        debug: false,
        prod: false,
        cwd: root,
      });
      expect(code).toBe(0);
      expect(spawn.mock.calls[0]?.[0]).toEqual(["bun", "src/main.ts"]);
      expect(spawn.mock.calls[0]?.[1]).toMatchObject({ cwd: join(root, "apps/api") });
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
    await Bun.write(
      join(root, "package.json"),
      JSON.stringify({
        name: "app",
        version: "1.0.0",
        packageManager: "bun@1.4.5",
        dependencies: { "@aponiajs/platform-elysia": "1.0.0-beta.61" },
      }),
    );
    const log = spyOn(console, "log").mockImplementation(() => {});

    try {
      await runInfoCommand({ command: "info", json: true, cwd: root });
      const payload = JSON.parse(String(log.mock.calls[0]?.[0])) as {
        readonly root: string;
        readonly framework: string | null;
        readonly packageManager: string;
        readonly projects: readonly { readonly name: string; readonly type: string }[];
      };
      expect(payload.root).toBe(root);
      expect(payload.framework).toBe("1.0.0-beta.61");
      expect(payload.packageManager).toBe("bun@1.4.5");
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

  test("generates an application whose configuration is platform-neutral", async () => {
    const root = await temporaryRoot();
    await generateProject({
      name: "hono-api",
      cwd: root,
      directory: "checkout",
      skipInstall: true,
      skipSkills: true,
      skipGit: true,
    });
    const manifest = (await Bun.file(join(root, "checkout", "package.json")).json()) as {
      readonly dependencies: Readonly<Record<string, string>>;
    };
    const configuration = (await Bun.file(join(root, "checkout", "aponia-cli.json")).json()) as {
      readonly platform?: unknown;
      readonly collection?: string;
    };

    expect(manifest.dependencies["@aponiajs/platform-elysia"]).toBeDefined();
    expect(configuration.collection).toBe("@aponiajs/schematics");
    expect(configuration.platform).toBeUndefined();
    expect(await Bun.file(join(root, "checkout", "src", "main.ts")).text()).toContain(
      "@aponiajs/platform-elysia",
    );
  });
});
