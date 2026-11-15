import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArguments, runCli } from "../src/index.ts";
import { generateSchematic } from "../src/generation/schematic-generator.ts";
import { checkLibrary } from "../src/library/check-library.ts";
import { aponiaVersion } from "../src/version.ts";

describe("aponia library check", () => {
  test("parses the check action and its publish flag", () => {
    expect(parseArguments(["library", "check", "libs/widgets", "--json", "--publish"])).toEqual({
      command: "library",
      action: "check",
      path: "libs/widgets",
      json: true,
      publish: true,
    });
  });

  test("parses the standalone new action and its scope", () => {
    expect(parseArguments(["library", "new", "widgets", "--scope", "acme"])).toMatchObject({
      command: "library",
      action: "new",
      name: "widgets",
      scope: "acme",
      skipInstall: false,
    });
  });

  test("parses the publish action and its confirmation flags", () => {
    expect(
      parseArguments(["library", "publish", "libs/widgets", "--yes", "--tag", "beta"]),
    ).toMatchObject({
      command: "library",
      action: "publish",
      path: "libs/widgets",
      yes: true,
      tag: "beta",
    });
  });

  test("writes a standalone scoped package without a workspace", async () => {
    const projectRoot = await createProjectRoot("aponia-library-standalone-");
    await generateSchematic({
      command: "generate",
      schematic: "library",
      name: "widgets",
      scope: "acme",
      dryRun: false,
      skipImport: false,
      crud: false,
      type: "rest",
      publish: true,
      skipInstall: true,
      standalone: true,
      cwd: projectRoot,
    });

    const manifest = (await Bun.file(join(projectRoot, "widgets/package.json")).json()) as {
      readonly name: string;
      readonly version: string;
      readonly peerDependencies: Readonly<Record<string, string>>;
    };
    expect(manifest.name).toBe("@acme/widgets");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.peerDependencies["@aponiajs/common"]).toBe(`^${aponiaVersion}`);
    expect(await Bun.file(join(projectRoot, "libs/widgets/package.json")).exists()).toBe(false);
  });

  test("accepts a generated publishable library", async () => {
    const projectRoot = await createProjectRoot("aponia-library-check-");
    await generateSchematic({
      command: "generate",
      schematic: "library",
      name: "widgets",
      dryRun: false,
      skipImport: false,
      crud: false,
      type: "rest",
      publish: true,
      skipInstall: true,
      cwd: projectRoot,
    });

    const result = await checkLibrary({
      cwd: projectRoot,
      path: "libs/widgets",
      publish: true,
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("reports a missing package surface file", async () => {
    const projectRoot = await createProjectRoot("aponia-library-check-issues-");
    await generateSchematic({
      command: "generate",
      schematic: "library",
      name: "widgets",
      dryRun: false,
      skipImport: false,
      crud: false,
      type: "rest",
      publish: true,
      skipInstall: true,
      cwd: projectRoot,
    });
    await rm(join(projectRoot, "libs/widgets/llms.txt"));

    const result = await checkLibrary({
      cwd: projectRoot,
      path: "libs/widgets",
      publish: true,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("missing llms.txt");
  });

  test("prints a valid library result and exits zero", async () => {
    const projectRoot = await createProjectRoot("aponia-library-cli-");
    await generateSchematic({
      command: "generate",
      schematic: "library",
      name: "widgets",
      dryRun: false,
      skipImport: false,
      crud: false,
      type: "rest",
      publish: true,
      skipInstall: true,
      cwd: projectRoot,
    });
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((message) => {
      lines.push(String(message));
    });

    try {
      expect(
        await runCli(["library", "check", join(projectRoot, "libs/widgets"), "--publish"]),
      ).toBe(0);
      expect(lines[0]).toContain("Library is valid:");
    } finally {
      log.mockRestore();
    }
  });

  test("creates a standalone library through the CLI action", async () => {
    const projectRoot = await createProjectRoot("aponia-library-new-cli-");
    const previous = process.cwd();
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((message) => {
      lines.push(String(message));
    });
    try {
      process.chdir(projectRoot);
      expect(await runCli(["library", "new", "widgets", "--scope", "acme", "--skip-install"])).toBe(
        0,
      );
    } finally {
      process.chdir(previous);
      log.mockRestore();
    }

    expect(lines.some((line) => line.startsWith("CREATE"))).toBe(true);
    expect(await Bun.file(join(projectRoot, "widgets/package.json")).exists()).toBe(true);
  });

  test("reports a failed publish check without running npm", async () => {
    const errors: string[] = [];
    const error = spyOn(console, "error").mockImplementation((message) => {
      errors.push(String(message));
    });
    try {
      expect(await runCli(["library", "publish", "missing-library"])).toBe(1);
    } finally {
      error.mockRestore();
    }
    expect(errors.length).toBeGreaterThan(0);
  });

  test("reports package, manifest, and documentation defects at once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aponia-library-invalid-"));
    await Bun.write(
      join(directory, "package.json"),
      `${JSON.stringify(
        {
          name: "widgets",
          private: true,
          type: "commonjs",
          exports: {},
          files: [],
          scripts: { postinstall: "echo nope" },
          dependencies: {},
        },
        undefined,
        2,
      )}\n`,
    );
    await Bun.write(
      join(directory, "aponia.library.json"),
      `${JSON.stringify(
        {
          contractVersion: 2,
          name: "other",
          kind: "other",
          framework: {},
          entrypoints: [],
          provides: [],
          security: { postinstall: true },
        },
        undefined,
        2,
      )}\n`,
    );
    await mkdir(join(directory, "src"), { recursive: true });
    await Bun.write(join(directory, "src/index.ts"), "export {};\n");
    await Bun.write(join(directory, "README.md"), "# widgets\n");

    const result = await checkLibrary({ path: directory, publish: true });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'package.json type must be "module"',
        "a publishable library must not set private: true",
        'a publishable library needs publishConfig.access "public"',
        'package.json exports must declare the "." entrypoint',
        "package.json files must include dist",
        "package.json must not declare a postinstall script",
        "package.json must depend on or peer-depend on @aponiajs/common",
        "aponia.library.json contractVersion must be 1",
        "aponia.library.json name must match package.json name",
        "aponia.library.json framework.aponia must be a string",
        "aponia.library.json entrypoints must be a non-empty array",
        "aponia.library.json provides must be a non-empty array",
        "aponia.library.json security.postinstall must not be true",
        "missing AGENTS.md",
        "missing llms.txt",
        "missing tests/",
        "missing tests-vp/",
      ]),
    );
  });

  test("reports publish metadata and provides mismatches", async () => {
    const projectRoot = await createProjectRoot("aponia-library-publish-issues-");
    await generateSchematic({
      command: "generate",
      schematic: "library",
      name: "widgets",
      dryRun: false,
      skipImport: false,
      crud: false,
      type: "rest",
      publish: true,
      skipInstall: true,
      cwd: projectRoot,
    });
    const directory = join(projectRoot, "libs/widgets");
    const packageJson = (await Bun.file(join(directory, "package.json")).json()) as Record<
      string,
      unknown
    >;
    await Bun.write(
      join(directory, "package.json"),
      `${JSON.stringify({ ...packageJson, version: "not-semver", keywords: [], license: "" })}\n`,
    );
    const manifest = (await Bun.file(join(directory, "aponia.library.json")).json()) as {
      readonly provides: readonly { readonly kind: string; readonly token: string }[];
    };
    await Bun.write(
      join(directory, "aponia.library.json"),
      `${JSON.stringify(
        {
          ...manifest,
          provides: [...manifest.provides, { kind: "provider", token: "MissingToken" }],
        },
        undefined,
        2,
      )}\n`,
    );

    const result = await checkLibrary({ path: directory, publish: true });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "a publishable library needs a semver version",
        "a publishable library needs the keyword aponiajs",
        "a publishable library needs the keyword aponia-library",
        "a publishable library needs a license",
        "aponia.library.json provides MissingToken but src/index.ts does not export it",
      ]),
    );
  });
});

async function createProjectRoot(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await Bun.write(
    join(projectRoot, "aponia.json"),
    `${JSON.stringify({ sourceRoot: "src", generateOptions: { spec: true } }, undefined, 2)}\n`,
  );
  await Bun.write(
    join(projectRoot, "src/app.module.ts"),
    'import { Module } from "@aponiajs/common";\n\n@Module({})\nexport class AppModule {}\n',
  );
  return projectRoot;
}
