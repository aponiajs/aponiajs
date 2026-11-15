import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { scanSourceFiles } from "../src/generation/file-scanner.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/**
 * The scan the build reads its sources through: the include pattern decides
 * what is read, the ignore list decides what is skipped, and every answer is
 * an absolute path under the directory the scan started from.
 */
async function writeProject(files: readonly string[]): Promise<string> {
  const directory = await mkdtemp(join(import.meta.dir, "..", "node_modules", ".aponia-scan-"));
  temporaryDirectories.push(directory);

  for (const file of files) {
    await Bun.write(join(directory, file), "export const value = 1;\n");
  }

  return directory;
}

test("lists every source file under the directory as absolute paths", async () => {
  const directory = await writeProject(["app.module.ts", "users/users.controller.ts"]);

  const files = await scanSourceFiles("**/*.module.ts", directory);

  expect(files).toEqual([join(directory, "app.module.ts")]);
});

test("skips whatever the ignore patterns name", async () => {
  const directory = await writeProject([
    "app.controller.ts",
    "app.controller.spec.ts",
    "app.controller.test.ts",
    "invokers.generated.ts",
  ]);

  const files = await scanSourceFiles("**/*.ts", directory, [
    "**/*.spec.ts",
    "**/*.test.ts",
    "**/invokers.generated.ts",
  ]);

  expect(files).toEqual([join(directory, "app.controller.ts")]);
});

test("answers no files when the directory holds none", async () => {
  const directory = await writeProject(["readme.md"]);

  expect(await scanSourceFiles("**/*.module.ts", directory)).toEqual([]);
  expect(await scanSourceFiles("**/*.ts", directory, ["**/*.md"])).toEqual([]);
});
