import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSchematic, runCli, type GenerateSchematicOptions } from "../src/index.ts";
import { readConfiguration } from "../src/generation/project-configuration.ts";

const temporaryDirectories: string[] = [];
const initialWorkingDirectory = process.cwd();

afterEach(async () => {
  process.chdir(initialWorkingDirectory);
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("generates under the path override and still registers the new symbol", async () => {
  const projectRoot = await createProjectRoot("aponia-path-override-");

  const result = await generateSchematic(
    baseOptions({ schematic: "service", name: "users", path: "src/feature", cwd: projectRoot }),
  );

  expect(result.changes).toEqual([
    { kind: "CREATE", path: "src/feature/users/users.service.ts" },
    { kind: "CREATE", path: "src/feature/users/users.service.spec.ts" },
    { kind: "UPDATE", path: "src/app.module.ts" },
  ]);
  expect(await Bun.file(join(projectRoot, "src/app.module.ts")).text()).toContain(
    'import { UsersService } from "./feature/users/users.service.ts";',
  );
});

test("rejects a path override that escapes the project root without writing files", async () => {
  const projectRoot = await createProjectRoot("aponia-path-escape-");

  expect(
    await failureOf(
      generateSchematic(
        baseOptions({ schematic: "service", name: "users", path: "../outside", cwd: projectRoot }),
      ),
    ),
  ).toMatchObject({ message: 'Path "../outside" escapes the project root.' });
  const writtenFiles = await Array.fromAsync(new Bun.Glob("**/*").scan(projectRoot));
  expect(writtenFiles.toSorted()).toEqual(["aponia.json", "src/app.module.ts"]);
});

test("skips module registration when skipImport is set", async () => {
  const projectRoot = await createProjectRoot("aponia-skip-import-");
  const before = await Bun.file(join(projectRoot, "src/app.module.ts")).text();

  const result = await generateSchematic(
    baseOptions({ schematic: "service", name: "users", skipImport: true, cwd: projectRoot }),
  );

  expect(result.changes).toEqual([
    { kind: "CREATE", path: "src/users/users.service.ts" },
    { kind: "CREATE", path: "src/users/users.service.spec.ts" },
  ]);
  expect(await Bun.file(join(projectRoot, "src/app.module.ts")).text()).toBe(before);
});

test("refuses to generate when registration was asked for and no module exists", async () => {
  const projectRoot = await createTemporaryProject("aponia-no-module-", { sourceRoot: "src" });

  const message = await failureMessageOf(
    generateSchematic(baseOptions({ schematic: "service", name: "users", cwd: projectRoot })),
  );

  // Registration is the documented default, so reporting success while
  // skipping it would describe a run that only wrote half the files.
  expect(message).toContain('"src/users/users.service.ts"');
  expect(message).toContain('"--skip-import"');
  const writtenFiles = await Array.fromAsync(new Bun.Glob("**/*").scan(projectRoot));
  expect(writtenFiles.toSorted()).toEqual(["aponia.json"]);
});

test("defaults the source root to src when aponia.json omits it", async () => {
  const projectRoot = await createTemporaryProject("aponia-default-source-root-", {});
  // The module lives at the default root, so finding it proves the default.
  await Bun.write(
    join(projectRoot, "src/app.module.ts"),
    'import { Module } from "@aponiajs/common";\n\n@Module({})\nexport class AppModule {}\n',
  );

  const result = await generateSchematic(
    baseOptions({ schematic: "service", name: "users", cwd: projectRoot }),
  );

  expect(result.changes).toEqual([
    { kind: "CREATE", path: "src/users/users.service.ts" },
    { kind: "CREATE", path: "src/users/users.service.spec.ts" },
    { kind: "UPDATE", path: "src/app.module.ts" },
  ]);
  expect(await Bun.file(join(projectRoot, "src/users/users.service.ts")).exists()).toBe(true);
});

test("names the configured source root when it holds no module to register into", async () => {
  const projectRoot = await createTemporaryProject("aponia-missing-source-root-", {
    sourceRoot: "app",
  });

  const message = await failureMessageOf(
    generateSchematic(baseOptions({ schematic: "service", name: "users", cwd: projectRoot })),
  );

  expect(message).toContain('inside "app"');
  expect(message).toContain('"--skip-import"');
  expect(await Bun.file(join(projectRoot, "app/users/users.service.ts")).exists()).toBe(false);
});

test("creates a configured source root that does not exist yet when registration is skipped", async () => {
  const projectRoot = await createTemporaryProject("aponia-missing-source-root-", {
    sourceRoot: "app",
  });

  const result = await generateSchematic(
    baseOptions({ schematic: "service", name: "users", skipImport: true, cwd: projectRoot }),
  );

  expect(result.changes).toEqual([
    { kind: "CREATE", path: "app/users/users.service.ts" },
    { kind: "CREATE", path: "app/users/users.service.spec.ts" },
  ]);
  expect(await Bun.file(join(projectRoot, "app/users/users.service.ts")).exists()).toBe(true);
});

test("registers into the module named by the module option and leaves the root module alone", async () => {
  const projectRoot = await createProjectRoot("aponia-module-selection-");
  const rootModule = join(projectRoot, "src/app.module.ts");
  const before = await Bun.file(rootModule).text();
  await mkdir(join(projectRoot, "src/admin"), { recursive: true });
  await Bun.write(
    join(projectRoot, "src/admin/admin.module.ts"),
    'import { Module } from "@aponiajs/common";\n\n@Module({})\nexport class AdminModule {}\n',
  );

  const result = await generateSchematic(
    baseOptions({ schematic: "service", name: "users", module: "admin/admin", cwd: projectRoot }),
  );

  expect(result.changes).toEqual([
    { kind: "CREATE", path: "src/users/users.service.ts" },
    { kind: "CREATE", path: "src/users/users.service.spec.ts" },
    { kind: "UPDATE", path: "src/admin/admin.module.ts" },
  ]);
  expect(await Bun.file(join(projectRoot, "src/admin/admin.module.ts")).text()).toContain(
    "providers: [UsersService]",
  );
  expect(await Bun.file(rootModule).text()).toBe(before);
});

test("places resource files in the source root when flat is set and omits specs when disabled", async () => {
  const projectRoot = await createProjectRoot("aponia-resource-flat-");

  const result = await generateSchematic(
    baseOptions({
      schematic: "resource",
      name: "orders",
      flat: true,
      spec: false,
      cwd: projectRoot,
    }),
  );

  expect(result.changes).toEqual([
    { kind: "CREATE", path: "src/orders.module.ts" },
    { kind: "CREATE", path: "src/orders.service.ts" },
    { kind: "CREATE", path: "src/orders.model.ts" },
    { kind: "CREATE", path: "src/entities/order.entity.ts" },
    { kind: "CREATE", path: "src/orders.controller.ts" },
    { kind: "UPDATE", path: "src/app.module.ts" },
  ]);
});

test("generates an unconnected scaffold for a microservice resource", async () => {
  const projectRoot = await createProjectRoot("aponia-microservice-resource-");

  const result = await generateSchematic(
    baseOptions({ schematic: "resource", name: "orders", type: "microservice", cwd: projectRoot }),
  );

  expect(result.changes).toEqual([
    { kind: "CREATE", path: "src/orders/orders.module.ts" },
    { kind: "CREATE", path: "src/orders/orders.service.ts" },
    { kind: "CREATE", path: "src/orders/dto/create-order.dto.ts" },
    { kind: "CREATE", path: "src/orders/dto/update-order.dto.ts" },
    { kind: "CREATE", path: "src/orders/entities/order.entity.ts" },
    { kind: "CREATE", path: "src/orders/orders.controller.ts" },
    { kind: "CREATE", path: "src/orders/orders.service.spec.ts" },
    { kind: "CREATE", path: "src/orders/orders.controller.spec.ts" },
    { kind: "UPDATE", path: "src/app.module.ts" },
  ]);
  // Microservice transports are not implemented, so the scaffold stays
  // unconnected: the class is emitted beside the service, but the module
  // registers only the service. The file's own comment is the other half of
  // the claim — it states that the class is not registered anywhere.
  expect(await Bun.file(join(projectRoot, "src/orders/orders.controller.ts")).text()).toContain(
    "microservice transport scaffold. This class is not registered anywhere",
  );
  expect(await Bun.file(join(projectRoot, "src/orders/orders.module.ts")).text()).toContain(
    "providers: [OrdersService]",
  );
  expect(await Bun.file(join(projectRoot, "src/orders/orders.module.ts")).text()).not.toContain(
    "OrdersController",
  );
});

test("nests a class in its own directory when flat is explicitly disabled", async () => {
  const projectRoot = await createProjectRoot("aponia-no-flat-class-");

  const result = await generateSchematic(
    baseOptions({ schematic: "class", name: "sample", flat: false, cwd: projectRoot }),
  );

  expect(result.changes).toEqual([
    { kind: "CREATE", path: "src/sample/sample.ts" },
    { kind: "CREATE", path: "src/sample/sample.spec.ts" },
  ]);
});

test("reports an existing file during a dry run without overwriting it", async () => {
  const projectRoot = await createProjectRoot("aponia-dry-run-conflict-");
  const existingFile = join(projectRoot, "src/reports/reports.service.ts");
  await mkdir(join(projectRoot, "src/reports"), { recursive: true });
  await Bun.write(existingFile, "user content\n");

  expect(
    await failureOf(
      generateSchematic(
        baseOptions({ schematic: "service", name: "reports", dryRun: true, cwd: projectRoot }),
      ),
    ),
  ).toMatchObject({ message: 'File "src/reports/reports.service.ts" already exists.' });
  expect(await Bun.file(existingFile).text()).toBe("user content\n");
});

test.serial("rejects a malformed aponia.json with the original parse failure", async () => {
  const projectRoot = await createTemporaryProject("aponia-malformed-config-", {});
  await Bun.write(join(projectRoot, "aponia.json"), '{ "sourceRoot": ');

  expect(await failureOf(readConfiguration(projectRoot))).toBeInstanceOf(SyntaxError);
  expect(await runCliFrom(projectRoot, ["generate", "service", "users"])).toEqual({
    exitCode: 1,
    errors: [expect.stringMatching(/^Aponia CLI error: /)],
  });
});

test.serial("rejects an empty aponia.json even though the file exists", async () => {
  const projectRoot = await createTemporaryProject("aponia-empty-config-", {});
  await Bun.write(join(projectRoot, "aponia.json"), "");

  expect(await failureOf(readConfiguration(projectRoot))).toBeInstanceOf(SyntaxError);
  expect(await runCliFrom(projectRoot, ["generate", "service", "users"])).toEqual({
    exitCode: 1,
    errors: [expect.stringMatching(/^Aponia CLI error: /)],
  });
});

test.serial(
  "requires the project root as the working directory instead of searching upwards",
  async () => {
    const projectRoot = await createProjectRoot("aponia-nested-directory-");
    const nestedDirectory = join(projectRoot, "src", "deep");
    await mkdir(nestedDirectory, { recursive: true });

    expect(await runCliFrom(nestedDirectory, ["generate", "service", "users"])).toEqual({
      exitCode: 1,
      errors: [
        'Aponia CLI error: Could not find "aponia.json". Run the command from an Aponia project root.',
      ],
    });
    expect(await Bun.file(join(nestedDirectory, "users")).exists()).toBe(false);
  },
);

function baseOptions(
  options: Partial<GenerateSchematicOptions> &
    Pick<GenerateSchematicOptions, "schematic" | "name" | "cwd">,
): GenerateSchematicOptions {
  return {
    command: "generate",
    dryRun: false,
    skipImport: false,
    crud: true,
    type: "rest",
    ...options,
  };
}

async function failureOf(operation: Promise<unknown>): Promise<unknown> {
  return operation.then(
    () => undefined,
    (error: unknown) => error,
  );
}

async function failureMessageOf(operation: Promise<unknown>): Promise<string> {
  const error = await failureOf(operation);
  if (!(error instanceof Error)) {
    throw new TypeError("Expected the operation to reject with an Error.");
  }

  return error.message;
}

async function runCliFrom(
  directory: string,
  arguments_: readonly string[],
): Promise<{ readonly exitCode: number; readonly errors: readonly string[] }> {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => {
    errors.push(String(message));
  };
  process.chdir(directory);
  try {
    return { exitCode: await runCli(arguments_), errors };
  } finally {
    console.error = originalError;
  }
}

async function createProjectRoot(prefix: string): Promise<string> {
  const projectRoot = await createTemporaryProject(prefix, { sourceRoot: "src" });
  await Bun.write(
    join(projectRoot, "src/app.module.ts"),
    'import { Module } from "@aponiajs/common";\n\n@Module({})\nexport class AppModule {}\n',
  );
  return projectRoot;
}

async function createTemporaryProject(
  prefix: string,
  configuration: Readonly<Record<string, unknown>>,
): Promise<string> {
  // `mkdtemp` reports the /var spelling while `process.cwd()` reports the
  // canonical /private/var spelling on macOS, so resolve before comparing.
  const projectRoot = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  temporaryDirectories.push(projectRoot);
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await Bun.write(
    join(projectRoot, "aponia.json"),
    `${JSON.stringify(configuration, undefined, 2)}\n`,
  );
  return projectRoot;
}
