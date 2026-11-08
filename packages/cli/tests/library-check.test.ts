import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArguments, runCli } from "../src/index.ts";
import { generateSchematic } from "../src/generation/schematic-generator.ts";
import { checkLibrary } from "../src/library/check-library.ts";

describe("aponia library check", () => {
  test("parses the check action and its publish flag", () => {
    expect(parseArguments(["library", "check", "packages/widgets", "--json", "--publish"])).toEqual(
      {
        command: "library",
        action: "check",
        path: "packages/widgets",
        json: true,
        publish: true,
      },
    );
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
      cwd: projectRoot,
    });

    const result = await checkLibrary({
      cwd: projectRoot,
      path: "packages/widgets",
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
      cwd: projectRoot,
    });
    await rm(join(projectRoot, "packages/widgets/llms.txt"));

    const result = await checkLibrary({
      cwd: projectRoot,
      path: "packages/widgets",
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
      cwd: projectRoot,
    });
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((message) => {
      lines.push(String(message));
    });

    try {
      expect(
        await runCli(["library", "check", join(projectRoot, "packages/widgets"), "--publish"]),
      ).toBe(0);
      expect(lines[0]).toContain("Library is valid:");
    } finally {
      log.mockRestore();
    }
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
