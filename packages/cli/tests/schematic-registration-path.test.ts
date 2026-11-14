import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/index.ts";

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

interface CliRun {
  readonly exitCode: number;
  readonly output: readonly string[];
  readonly errors: readonly string[];
}

test.serial(
  "registers a generated declaration in the nearest module on the default path",
  async () => {
    const projectRoot = await createProject("aponia-registration-default-");
    const run = await runGenerate(projectRoot, ["service", "reports"]);

    expect(run.exitCode).toBe(0);
    expect(run.errors).toEqual([]);
    expect(run.output).toEqual([
      "CREATE src/reports/reports.service.ts",
      "CREATE src/reports/reports.service.spec.ts",
      "UPDATE src/app.module.ts",
    ]);
    const moduleSource = await Bun.file(join(projectRoot, "src/app.module.ts")).text();
    expect(moduleSource).toContain(
      'import { ReportsService } from "./reports/reports.service.ts";',
    );
    expect(moduleSource).toContain("providers: [ReportsService]");
  },
);

test.serial(
  "registers a generated declaration when --path stays inside the source root",
  async () => {
    const projectRoot = await createProject("aponia-registration-inside-");
    const run = await runGenerate(projectRoot, ["service", "billing", "--path", "src/features"]);

    expect(run.exitCode).toBe(0);
    expect(run.errors).toEqual([]);
    expect(run.output).toEqual([
      "CREATE src/features/billing/billing.service.ts",
      "CREATE src/features/billing/billing.service.spec.ts",
      "UPDATE src/app.module.ts",
    ]);
    expect(await Bun.file(join(projectRoot, "src/app.module.ts")).text()).toContain(
      'import { BillingService } from "./features/billing/billing.service.ts";',
    );
  },
);

test.serial("fails and writes nothing when --path lands outside the source root", async () => {
  const projectRoot = await createProject("aponia-registration-outside-");
  const before = await Bun.file(join(projectRoot, "src/app.module.ts")).text();
  const run = await runGenerate(projectRoot, ["service", "users", "--path", "generated"]);

  expect(run.exitCode).toBe(1);
  expect(run.output).toEqual([]);
  expect(run.errors).toHaveLength(1);
  expect(run.errors[0]).toContain("generated/users/users.service.ts");
  expect(run.errors[0]).toContain('"--skip-import"');

  // The failure happens before the write phase, so a later run has nothing to clean up.
  expect(await Bun.file(join(projectRoot, "generated")).exists()).toBe(false);
  expect(await Bun.file(join(projectRoot, "src/app.module.ts")).text()).toBe(before);

  const retry = await runGenerate(projectRoot, [
    "service",
    "users",
    "--path",
    "generated",
    "--skip-import",
  ]);
  expect(retry.exitCode).toBe(0);
  expect(retry.output).toContain("CREATE generated/users/users.service.ts");
  expect(await Bun.file(join(projectRoot, "src/app.module.ts")).text()).toBe(before);
});

test.serial("generates outside the source root with --skip-import and exits zero", async () => {
  const projectRoot = await createProject("aponia-registration-skip-import-");
  const before = await Bun.file(join(projectRoot, "src/app.module.ts")).text();
  const run = await runGenerate(projectRoot, [
    "service",
    "users",
    "--path",
    "generated",
    "--skip-import",
  ]);

  expect(run.exitCode).toBe(0);
  expect(run.errors).toEqual([]);
  expect(run.output).toEqual([
    "CREATE generated/users/users.service.ts",
    "CREATE generated/users/users.service.spec.ts",
  ]);
  expect(await Bun.file(join(projectRoot, "generated/users/users.service.ts")).exists()).toBe(true);
  expect(await Bun.file(join(projectRoot, "src/app.module.ts")).text()).toBe(before);
});

test.serial(
  "does not fail an out-of-root --path for a schematic without a registration kind",
  async () => {
    const projectRoot = await createProject("aponia-registration-none-");
    const run = await runGenerate(projectRoot, ["class", "http", "--path", "generated"]);

    expect(run.exitCode).toBe(0);
    expect(run.errors).toEqual([]);
    expect(run.output).toEqual(["CREATE generated/http.ts", "CREATE generated/http.spec.ts"]);
    expect(await Bun.file(join(projectRoot, "generated/http.ts")).exists()).toBe(true);
  },
);

test.serial("fails in dry-run mode when an out-of-root --path cannot be registered", async () => {
  const projectRoot = await createProject("aponia-registration-dry-run-");
  const run = await runGenerate(projectRoot, [
    "service",
    "users",
    "--path",
    "generated",
    "--dry-run",
  ]);

  expect(run.exitCode).toBe(1);
  expect(run.output).toEqual([]);
  expect(run.errors[0]).toContain('"--skip-import"');
  expect(await Bun.file(join(projectRoot, "generated")).exists()).toBe(false);
});

test.serial("fails when the source root itself declares no module", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "aponia-registration-no-module-"));
  temporaryDirectories.push(projectRoot);
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await Bun.write(
    join(projectRoot, "aponia.json"),
    `${JSON.stringify({ sourceRoot: "src" }, undefined, 2)}\n`,
  );

  const run = await runGenerate(projectRoot, ["service", "users"]);

  expect(run.exitCode).toBe(1);
  expect(run.output).toEqual([]);
  expect(run.errors[0]).toContain('"--skip-import"');
  expect(await Bun.file(join(projectRoot, "src/users/users.service.ts")).exists()).toBe(false);
});

async function createProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(projectRoot);
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await Bun.write(
    join(projectRoot, "aponia.json"),
    `${JSON.stringify({ sourceRoot: "src" }, undefined, 2)}\n`,
  );
  await Bun.write(
    join(projectRoot, "src/app.module.ts"),
    'import { Module } from "@aponiajs/common";\n\n@Module({})\nexport class AppModule {}\n',
  );
  return projectRoot;
}

async function runGenerate(projectRoot: string, arguments_: readonly string[]): Promise<CliRun> {
  process.chdir(projectRoot);
  const output: string[] = [];
  const errors: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    output.push(String(message));
  });
  const error = spyOn(console, "error").mockImplementation((message) => {
    errors.push(String(message));
  });

  try {
    return { exitCode: await runCli(["generate", ...arguments_]), output, errors };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}
