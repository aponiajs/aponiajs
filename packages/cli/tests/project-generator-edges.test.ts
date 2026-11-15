import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateProject } from "../src/index.ts";

const temporaryDirectories: string[] = [];
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test.skipIf(isRoot)(
  "rethrows an unexpected directory failure unchanged without creating the target",
  async () => {
    const temporaryDirectory = await createTemporaryDirectory("aponia-lstat-failure-");
    const blockedDirectory = join(temporaryDirectory, "blocked");
    await mkdir(blockedDirectory);
    await chmod(blockedDirectory, 0o000);
    let failure: unknown;

    try {
      await generateProject({
        name: "sample-api",
        cwd: blockedDirectory,
        skipInstall: true,
      });
    } catch (error) {
      failure = error;
    } finally {
      await chmod(blockedDirectory, 0o700);
    }

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ code: "EACCES" });
    expect(await Bun.file(join(blockedDirectory, "sample-api")).exists()).toBe(false);
  },
);

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
