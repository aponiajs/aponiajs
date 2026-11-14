import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateProject, runCli } from "../src/index.ts";
import { generateSchematic } from "../src/generation/schematic-generator.ts";

const initialWorkingDirectory = process.cwd();
const temporaryDirectories: string[] = [];

afterEach(async () => {
  process.chdir(initialWorkingDirectory);
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test.serial("lists every file a project dry run would write, in sorted order", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-run-cli-file-list-");
  process.chdir(temporaryDirectory);
  const expectedFiles = (
    await generateProject({ name: "dry-api", cwd: temporaryDirectory, dryRun: true })
  ).files;
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    output.push(String(message));
  });

  try {
    expect(await runCli(["new", "dry-api", "--dry-run"])).toBe(0);
  } finally {
    log.mockRestore();
  }

  expect(output[0]).toBe(`CREATE ${join(temporaryDirectory, "dry-api")}`);
  expect(output.slice(1)).toEqual(expectedFiles.map((file) => `  ${file}`));
  // The absolute list comes from the generator itself, so compare against a
  // sort of the reported lines to prove the CLI prints files in sorted order.
  expect(output.slice(1)).toEqual(output.slice(1).toSorted());
});

test.serial("reports a non-Error failure through console.error and returns 1", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-run-cli-non-error-");
  process.chdir(temporaryDirectory);
  const errors: string[] = [];
  const error = spyOn(console, "error").mockImplementation((message) => {
    errors.push(String(message));
  });
  const write = spyOn(Bun, "write").mockImplementation(() => {
    throw "disk offline";
  });

  try {
    expect(await runCli(["new", "sample-api", "--skip-install"])).toBe(1);
    expect(errors).toEqual(["Aponia CLI error: disk offline"]);
  } finally {
    write.mockRestore();
    error.mockRestore();
  }
});

test.serial("prints matching library search results and an empty result", async () => {
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    output.push(String(message));
  });

  try {
    expect(await runCli(["library", "search"])).toBe(0);
    expect(await runCli(["library", "search", "no-such-aponia-library"])).toBe(0);
  } finally {
    log.mockRestore();
  }

  expect(output[0]).toContain("[");
  expect(output.at(-1)).toBe("No libraries matched.");
});

test.serial("prints a library check result in human form", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-run-cli-library-check-");
  process.chdir(temporaryDirectory);
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
    cwd: temporaryDirectory,
  });
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    output.push(String(message));
  });

  try {
    expect(await runCli(["library", "check", join(temporaryDirectory, "widgets")])).toBe(0);
    expect(await runCli(["library", "check", "missing-library"])).toBe(1);
  } finally {
    log.mockRestore();
  }

  expect(output[0]).toContain("Library is valid:");
  expect(output[1]).toContain("Library check failed:");
  expect(output.length).toBeGreaterThan(2);
});

test.serial("installs agent guidance for the default clients", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-run-cli-agent-");
  process.chdir(temporaryDirectory);
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    output.push(String(message));
  });

  try {
    expect(await runCli(["agent", "init"])).toBe(0);
  } finally {
    log.mockRestore();
  }

  expect(output).toContain("CREATE AGENTS.md");
  expect(await Bun.file(join(temporaryDirectory, ".agents/skills/aponia/SKILL.md")).exists()).toBe(
    true,
  );
});

test.serial(
  "stops a publish on a failed build or pack and confirms the final command",
  async () => {
    const temporaryDirectory = await createTemporaryDirectory("aponia-run-cli-library-publish-");
    process.chdir(temporaryDirectory);
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
      cwd: temporaryDirectory,
    });
    const libraryDirectory = join(temporaryDirectory, "widgets");
    const commands: string[][] = [];
    const exitCodes = [2, 0, 1, 0, 0, 0];
    const spawn = spyOn(Bun, "spawnSync").mockImplementation(((
      command: readonly string[],
    ): unknown => {
      commands.push([...command]);
      return { exitCode: exitCodes.shift() ?? 0 };
    }) as unknown as typeof Bun.spawnSync);
    const output: string[] = [];
    const log = spyOn(console, "log").mockImplementation((message) => {
      output.push(String(message));
    });

    try {
      expect(await runCli(["library", "publish", libraryDirectory])).toBe(2);
      expect(await runCli(["library", "publish", libraryDirectory])).toBe(1);
      expect(await runCli(["library", "publish", libraryDirectory])).toBe(0);
      expect(await runCli(["library", "publish", libraryDirectory, "--yes", "--tag", "beta"])).toBe(
        0,
      );
    } finally {
      log.mockRestore();
      spawn.mockRestore();
    }

    expect(commands).toContainEqual(["bun", "run", "build"]);
    expect(commands).toContainEqual(["npm", "pack", "--dry-run"]);
    expect(commands.at(-1)).toEqual(["npm", "publish", "--access", "public", "--tag", "beta"]);
    expect(output.some((line) => line.startsWith("Library is ready to publish."))).toBe(true);
  },
);

async function createTemporaryDirectory(prefix: string): Promise<string> {
  // `mkdtemp` reports the /var spelling while `process.cwd()` reports the
  // canonical /private/var spelling on macOS, so resolve before comparing.
  const directory = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  temporaryDirectories.push(directory);
  return directory;
}
