import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  findModuleFile,
  readConfiguration,
  readSpecDefault,
  resolveInside,
  resolveProject,
  toImportPath,
} from "../src/generation/project-configuration.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

test("reads project configuration and rejects a missing configuration file", async () => {
  const projectRoot = await createTemporaryDirectory();
  const configuration = {
    sourceRoot: "src",
    generateOptions: { flat: true, spec: false },
  } as const;
  await Bun.write(join(projectRoot, "aponia.json"), JSON.stringify(configuration));

  expect(await readConfiguration(projectRoot)).toEqual(configuration);

  const missingRoot = await createTemporaryDirectory();
  expect(readConfiguration(missingRoot)).rejects.toThrow(
    'Could not find "aponia.json". Run the command from an Aponia project root.',
  );
});

test("resolves configured projects and rejects unknown project names", () => {
  const configuration = {
    projects: {
      api: {
        root: "apps/api",
        generateOptions: { spec: { service: true } },
      },
    },
  } as const;

  expect(resolveProject(configuration, undefined)).toEqual({});
  expect(resolveProject(configuration, "api")).toEqual({
    root: "apps/api",
    sourceRoot: "apps/api/src",
    generateOptions: { spec: { service: true } },
  });
  expect(() => resolveProject(configuration, "missing")).toThrow(
    'Unknown project "missing" in aponia.json.',
  );
});

test("reads boolean and per-schematic spec defaults", () => {
  expect(readSpecDefault(undefined, "service")).toBeUndefined();
  expect(readSpecDefault(false, "service")).toBe(false);
  expect(readSpecDefault({ controller: true, service: false }, "controller")).toBe(true);
  expect(readSpecDefault({ controller: true, service: false }, "service")).toBe(false);
  expect(readSpecDefault({ controller: true }, "module")).toBeUndefined();
});

test("keeps generated paths inside the project root", async () => {
  const projectRoot = await createTemporaryDirectory();

  expect(resolveInside(projectRoot, ".")).toBe(projectRoot);
  expect(resolveInside(projectRoot, "src/users")).toBe(join(projectRoot, "src/users"));
  expect(() => resolveInside(projectRoot, "../outside")).toThrow(
    'Path "../outside" escapes the project root.',
  );
  expect(() => resolveInside(projectRoot, join(projectRoot, "..", "outside"))).toThrow(
    "escapes the project root",
  );
});

test("finds an explicitly requested module and diagnoses missing or ambiguous matches", async () => {
  const sourceRoot = await createTemporaryDirectory();
  await Promise.all([
    writeModule(join(sourceRoot, "admin/users.module.ts"), "AdminUsersModule"),
    writeModule(join(sourceRoot, "public/users.module.ts"), "PublicUsersModule"),
    writeModule(join(sourceRoot, "app.module.ts"), "AppModule"),
  ]);

  expect(
    await findModuleFile({
      sourceRoot,
      fromDirectory: sourceRoot,
      requestedModule: "admin/users",
    }),
  ).toBe(join(sourceRoot, "admin/users.module.ts"));
  expect(
    await findModuleFile({
      sourceRoot,
      fromDirectory: sourceRoot,
      requestedModule: "app.module.ts",
    }),
  ).toBe(join(sourceRoot, "app.module.ts"));
  expect(
    findModuleFile({
      sourceRoot,
      fromDirectory: sourceRoot,
      requestedModule: "missing",
    }),
  ).rejects.toThrow('Could not find module "missing".');
  expect(
    findModuleFile({
      sourceRoot,
      fromDirectory: sourceRoot,
      requestedModule: "users",
    }),
  ).rejects.toThrow('Module "users" is ambiguous.');
});

test("selects the nearest module while respecting exclusions and unreadable directories", async () => {
  const sourceRoot = await createTemporaryDirectory();
  const featureDirectory = join(sourceRoot, "feature");
  const nestedDirectory = join(featureDirectory, "nested");
  const rootModule = join(sourceRoot, "app.module.ts");
  const featureModule = join(featureDirectory, "feature.module.ts");
  await mkdir(nestedDirectory, { recursive: true });
  await Promise.all([
    writeModule(rootModule, "AppModule"),
    writeModule(featureModule, "FeatureModule"),
  ]);

  expect(
    await findModuleFile({
      sourceRoot,
      fromDirectory: nestedDirectory,
    }),
  ).toBe(featureModule);
  expect(
    await findModuleFile({
      sourceRoot,
      fromDirectory: featureDirectory,
      excludedFile: featureModule,
    }),
  ).toBe(rootModule);

  const emptySourceRoot = await createTemporaryDirectory();
  expect(
    await findModuleFile({
      sourceRoot: emptySourceRoot,
      fromDirectory: join(emptySourceRoot, "missing", "nested"),
    }),
  ).toBeUndefined();
});

test("creates normalized relative import paths", () => {
  expect(toImportPath("/project/src/app.module.ts", "/project/src/users.service.ts")).toBe(
    "./users.service.ts",
  );
  expect(toImportPath("/project/src/admin/admin.module.ts", "/project/src/users.service.ts")).toBe(
    "../users.service.ts",
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aponia-project-configuration-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeModule(path: string, className: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(
    path,
    `import { Module } from "@aponiajs/common";\n\n@Module({})\nexport class ${className} {}\n`,
  );
}
