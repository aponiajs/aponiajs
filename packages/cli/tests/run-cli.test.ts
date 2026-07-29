import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/index.ts";
import { helpText } from "../src/commands/help-text.ts";
import { aponiaVersion } from "../src/version.ts";

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

test.serial("prints help and version output with successful exit codes", async () => {
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    output.push(String(message));
  });

  try {
    expect(await runCli([])).toBe(0);
    expect(await runCli(["--version"])).toBe(0);
    expect(output).toEqual([helpText, aponiaVersion]);
  } finally {
    log.mockRestore();
  }
});

test.serial("prints parser and generator failures without throwing", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-run-cli-error-");
  process.chdir(temporaryDirectory);
  const errors: string[] = [];
  const error = spyOn(console, "error").mockImplementation((message) => {
    errors.push(String(message));
  });

  try {
    expect(await runCli(["unknown"])).toBe(1);
    expect(await runCli(["generate", "service", "users"])).toBe(1);
    expect(errors).toEqual([
      'Aponia CLI error: Unknown command "unknown".',
      'Aponia CLI error: Could not find "aponia.json". Run the command from an Aponia project root.',
    ]);
  } finally {
    error.mockRestore();
  }
});

test.serial("reports a new project dry-run without writing files", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-run-cli-dry-");
  process.chdir(temporaryDirectory);
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    output.push(String(message));
  });

  try {
    expect(await runCli(["new", "dry-api", "--dry-run"])).toBe(0);
    expect(output[0]).toBe(`CREATE ${join(temporaryDirectory, "dry-api")}`);
    expect(output).toContain("  src/main.ts");
    expect(await Bun.file(join(temporaryDirectory, "dry-api")).exists()).toBe(false);
  } finally {
    log.mockRestore();
  }
});

test.serial("creates a project and prints native next steps", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-run-cli-new-");
  process.chdir(temporaryDirectory);
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    output.push(String(message));
  });

  try {
    expect(await runCli(["new", "sample-api", "--skip-install"])).toBe(0);
    expect(output).toEqual(["Created sample-api", "Next: cd sample-api && bun run dev"]);
    expect(await Bun.file(join(temporaryDirectory, "sample-api/src/main.ts")).exists()).toBe(true);
  } finally {
    log.mockRestore();
  }
});

test.serial("prints schematic CREATE and UPDATE changes", async () => {
  const projectRoot = await createTemporaryDirectory("aponia-run-cli-generate-");
  process.chdir(projectRoot);
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await Bun.write(
    join(projectRoot, "aponia.json"),
    `${JSON.stringify({ sourceRoot: "src" }, undefined, 2)}\n`,
  );
  await Bun.write(
    join(projectRoot, "src/app.module.ts"),
    'import { Module } from "@aponiajs/common";\n\n@Module({})\nexport class AppModule {}\n',
  );
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    output.push(String(message));
  });

  try {
    expect(await runCli(["generate", "service", "reports", "--dry-run"])).toBe(0);
    expect(output).toEqual(
      expect.arrayContaining([
        "CREATE src/reports/reports.service.ts",
        "CREATE src/reports/reports.service.spec.ts",
        "UPDATE src/app.module.ts",
      ]),
    );
    expect(await Bun.file(join(projectRoot, "src/reports/reports.service.ts")).exists()).toBe(
      false,
    );
  } finally {
    log.mockRestore();
  }
});

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
