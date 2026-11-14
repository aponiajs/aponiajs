import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findModuleFile, resolveProject } from "../src/generation/project-configuration.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("defaults a configured project's source root to src when it declares neither root nor sourceRoot", () => {
  expect(resolveProject({ projects: { api: {} } }, "api")).toEqual({ sourceRoot: "src" });
  expect(resolveProject({ projects: { api: { root: "apps/api" } } }, "api")).toEqual({
    root: "apps/api",
    sourceRoot: "apps/api/src",
  });
});

test("normalizes a requested module name written with its module suffix", async () => {
  const sourceRoot = await createTemporaryDirectory("aponia-module-suffix-");
  await mkdir(join(sourceRoot, "admin"), { recursive: true });
  await writeModule(join(sourceRoot, "admin/users.module.ts"), "AdminUsersModule");

  expect(
    await findModuleFile({
      sourceRoot,
      fromDirectory: sourceRoot,
      requestedModule: "admin/users.module",
    }),
  ).toBe(join(sourceRoot, "admin/users.module.ts"));
  expect(
    await findModuleFile({
      sourceRoot,
      fromDirectory: sourceRoot,
      requestedModule: "admin/users.module.ts",
    }),
  ).toBe(join(sourceRoot, "admin/users.module.ts"));
});

test("stops searching when the starting directory is outside the source root", async () => {
  const sourceRoot = await createTemporaryDirectory("aponia-outside-source-root-");
  await writeModule(join(sourceRoot, "app.module.ts"), "AppModule");

  expect(
    await findModuleFile({
      sourceRoot,
      fromDirectory: join(sourceRoot, "..", "generated"),
    }),
  ).toBeUndefined();
});

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
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
