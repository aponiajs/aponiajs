import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateProject, runCli } from "../src/index.ts";

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

async function createTemporaryDirectory(prefix: string): Promise<string> {
  // `mkdtemp` reports the /var spelling while `process.cwd()` reports the
  // canonical /private/var spelling on macOS, so resolve before comparing.
  const directory = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  temporaryDirectories.push(directory);
  return directory;
}
