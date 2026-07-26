import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateProject, parseArguments } from "../src/index.ts";
import { aponiaVersion } from "../src/version.ts";

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

async function createTemporaryDirectory(prefix = "aponia-cli-"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

test("parses Nest-style new aliases and safety options", () => {
  expect(parseArguments(["n", "sample-api", "-d", "-s"])).toEqual({
    command: "new",
    name: "sample-api",
    dryRun: true,
    skipInstall: true,
  });
});

test("generates a module-controller-service application", async () => {
  const temporaryDirectory = await createTemporaryDirectory();
  const result = await generateProject({
    name: "sample-api",
    cwd: temporaryDirectory,
    skipInstall: true,
  });
  const projectDirectory = join(temporaryDirectory, "sample-api");

  expect(result.installed).toBe(false);
  expect(await Bun.file(join(projectDirectory, "src/main.ts")).text()).toContain(
    "AponiaFactory.create(AppModule)",
  );
  expect(await Bun.file(join(projectDirectory, ".gitignore")).exists()).toBe(true);
  expect(await Bun.file(join(projectDirectory, "src/app.module.ts")).text()).toContain(
    "controllers: [AppController]",
  );
  expect(await Bun.file(join(projectDirectory, "src/app.controller.ts")).text()).toContain(
    "@Controller()",
  );
  expect(await Bun.file(join(projectDirectory, "src/app.controller.ts")).text()).toContain(
    "@Get()",
  );
  expect(await Bun.file(join(projectDirectory, "src/app.controller.spec.ts")).exists()).toBe(true);
  expect(await Bun.file(join(projectDirectory, "test/app.e2e-spec.ts")).exists()).toBe(true);
  expect(await Bun.file(join(projectDirectory, "src/modules")).exists()).toBe(false);

  const manifest = (await Bun.file(join(projectDirectory, "package.json")).json()) as {
    readonly dependencies: Readonly<Record<string, string>>;
  };
  expect(manifest.dependencies["@aponiajs/common"]).toBe(aponiaVersion);
  expect(manifest.dependencies["@aponiajs/platform-elysia"]).toBe(aponiaVersion);
  expect(manifest.dependencies["@aponiajs/core"]).toBeUndefined();

  for (const file of result.files) {
    expect(await Bun.file(join(projectDirectory, file)).text()).not.toContain("{{");
  }
});

test("dry-run does not create the target directory", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-dry-run-");
  const result = await generateProject({
    name: "dry-api",
    cwd: temporaryDirectory,
    dryRun: true,
  });

  expect(result.files).toContain("src/main.ts");
  expect(result.files).toEqual(result.files.toSorted());
  expect(await Bun.file(result.projectDirectory).exists()).toBe(false);
});

test.each(["", "SampleApi", "sample_api", "../sample-api", "sample--api", "sample-api-"])(
  "rejects unsafe project name %p without creating files",
  async (name) => {
    const temporaryDirectory = await createTemporaryDirectory("aponia-invalid-name-");

    expect(
      generateProject({
        name,
        cwd: temporaryDirectory,
        skipInstall: true,
      }),
    ).rejects.toThrow("Project name must use lowercase kebab-case and start with a letter.");
    expect((await Array.fromAsync(new Bun.Glob("*").scan(temporaryDirectory))).length).toBe(0);
  },
);

test("refuses to overwrite an existing target directory", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-existing-target-");
  const projectDirectory = join(temporaryDirectory, "sample-api");
  const markerPath = join(projectDirectory, "keep.txt");
  await mkdir(projectDirectory);
  await Bun.write(markerPath, "user content");

  expect(
    generateProject({
      name: "sample-api",
      cwd: temporaryDirectory,
      skipInstall: true,
    }),
  ).rejects.toThrow('Target directory "sample-api" already exists.');
  expect(await Bun.file(markerPath).text()).toBe("user content");
});

test.serial("removes a partially generated project when Bun install fails", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-install-failure-");
  const spawn = spyOn(Bun, "spawn").mockReturnValue({
    exited: Promise.resolve(23),
  } as ReturnType<typeof Bun.spawn>);
  let thrownError: unknown;
  try {
    try {
      await generateProject({
        name: "failed-api",
        cwd: temporaryDirectory,
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe("Bun install failed with exit code 23.");
    expect(spawn).toHaveBeenCalledTimes(1);
  } finally {
    spawn.mockRestore();
  }

  expect(await Bun.file(join(temporaryDirectory, "failed-api")).exists()).toBe(false);
});

test.each([
  [["new"], "Project name is required."],
  [["new", "sample-api", "extra"], 'Unexpected argument "extra".'],
  [["new", "sample-api", "--unknown"], 'Unknown option "--unknown".'],
] as const)("rejects invalid new command arguments", (arguments_, message) => {
  expect(() => parseArguments(arguments_)).toThrow(message);
});
