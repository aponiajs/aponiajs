import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
    "AponiaFactory.create(AppModule, {",
  );
  expect(await Bun.file(join(projectDirectory, ".gitignore")).exists()).toBe(true);
  expect(await Bun.file(join(projectDirectory, "src/app.module.ts")).text()).toContain(
    "controllers: [AppController]",
  );
  // The starter's port is a declared configuration rather than a bare
  // `Number(Bun.env.PORT ?? 3000)`: the module provides and exports it, and the
  // declaration lives beside the sources it belongs to.
  expect(await Bun.file(join(projectDirectory, "src/app.module.ts")).text()).toContain(
    "provideConfiguration(AppConfig)",
  );
  expect(await Bun.file(join(projectDirectory, "src/app.module.ts")).text()).toContain(
    "exports: [AppConfig]",
  );
  expect(await Bun.file(join(projectDirectory, "src/config.ts")).text()).toContain(
    "defineConfiguration",
  );
  // The entrypoint reads the validated value back rather than the environment,
  // which is the half that makes the declaration the port's only source.
  expect(await Bun.file(join(projectDirectory, "src/main.ts")).text()).toContain(
    "application.listen(application.get(AppConfig).port)",
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

test("ships agent guidance that names the project and points at the framework", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-agent-guide-");
  await generateProject({ name: "sample-api", cwd: temporaryDirectory, skipInstall: true });
  const projectDirectory = join(temporaryDirectory, "sample-api");

  const guide = await Bun.file(join(projectDirectory, "AGENTS.md")).text();
  const index = await Bun.file(join(projectDirectory, "llms.txt")).text();

  expect(guide).toContain("# sample-api");
  expect(guide).toContain("aponia generate resource users");
  expect(guide).toContain("AponiaFactory.create(AppModule, { logger: false })");
  expect(index).toContain("# sample-api");
  expect(index).toContain("](AGENTS.md)");
});

test("ships a runnable inspection script wired into the manifest", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-inspect-");
  await generateProject({ name: "sample-api", cwd: temporaryDirectory, skipInstall: true });
  const projectDirectory = join(temporaryDirectory, "sample-api");

  const script = await Bun.file(join(projectDirectory, "scripts/inspect.ts")).text();
  const manifest = (await Bun.file(join(projectDirectory, "package.json")).json()) as {
    readonly scripts: Readonly<Record<string, string>>;
  };

  expect(script).toContain('import { inspectAponiaApplication } from "@aponiajs/platform-elysia"');
  expect(script).toContain(
    'import { moduleDescriptorArtifact } from "../src/descriptors.generated.ts"',
  );
  expect(script).toContain('import { AppModule } from "../src/app.module.ts"');
  // The artifact is what makes the script describe the graph the application
  // boots from; without it the summary would be the decorated classes.
  expect(script).toContain("descriptors: moduleDescriptorArtifact");
  expect(script).toContain("--json");
  expect(manifest.scripts.inspect).toBe("bun run scripts/inspect.ts");
});

test("wires the build script to the build plugin and commits what it writes", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-build-");
  await generateProject({ name: "sample-api", cwd: temporaryDirectory, skipInstall: true });
  const projectDirectory = join(temporaryDirectory, "sample-api");

  const script = await Bun.file(join(projectDirectory, "scripts/build.ts")).text();
  const manifest = (await Bun.file(join(projectDirectory, "package.json")).json()) as {
    readonly scripts: Readonly<Record<string, string>>;
    readonly devDependencies: Readonly<Record<string, string>>;
  };
  const ignore = await Bun.file(join(projectDirectory, ".gitignore")).text();

  expect(script).toContain('import { buildPlugin } from "@aponiajs/cli"');
  expect(script).toContain("plugins: [buildPlugin()]");
  expect(script).toContain('entrypoints: ["./src/main.ts"]');
  expect(manifest.scripts.build).toBe("bun run scripts/build.ts");
  expect(manifest.devDependencies["@aponiajs/cli"]).toBe(aponiaVersion);
  // The build rewrites both modules beside the application's own sources, and
  // the starter ships them: they are application source that a build refreshes,
  // not build output that a build creates, so they belong in version control and
  // in the project's own `bun run check`.
  expect(ignore).not.toContain("generated.ts");
  expect(await Bun.file(join(projectDirectory, "src/invokers.generated.ts")).exists()).toBe(true);
  expect(await Bun.file(join(projectDirectory, "src/descriptors.generated.ts")).exists()).toBe(
    true,
  );
});

test("boots and tests the starter without running a build first", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-no-build-");
  await generateProject({ name: "sample-api", cwd: temporaryDirectory, skipInstall: true });
  const projectDirectory = join(temporaryDirectory, "sample-api");

  // `bun run dev`, `bun start`, and `bun test` import the sources directly, so
  // they must not need a build to have run. The entrypoint adopts the invoker
  // artifact, which it can only do because the starter commits the module the
  // build would otherwise be the first thing to write.
  const main = await Bun.file(join(projectDirectory, "src/main.ts")).text();
  expect(main).toContain('import { controllerInvokerArtifact } from "./invokers.generated.ts";');
  expect(main).toContain("invokers: controllerInvokerArtifact,");
  expect(await Bun.file(join(projectDirectory, "src/invokers.generated.ts")).exists()).toBe(true);
  expect(await Bun.file(join(projectDirectory, "src/descriptors.generated.ts")).exists()).toBe(
    true,
  );
});

test("indexes framework documentation that exists beside this template", async () => {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const index = await Bun.file(
    join(repositoryRoot, "packages/cli/templates/application/llms.txt"),
  ).text();
  const referenced = [...index.matchAll(/https:\/\/github\.com\/[^)]+\/(docs\/[^)]+\.md)/g)].map(
    (match) => match[1]!,
  );

  expect(referenced.length).toBeGreaterThan(0);

  const missing: string[] = [];
  for (const path of referenced) {
    if (!(await Bun.file(join(repositoryRoot, path)).exists())) {
      missing.push(path);
    }
  }
  expect(missing).toEqual([]);
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

test.serial("keeps a generated project when Bun install succeeds", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-install-success-");
  const spawn = spyOn(Bun, "spawn").mockReturnValue({
    exited: Promise.resolve(0),
  } as ReturnType<typeof Bun.spawn>);
  let installed = false;
  try {
    const result = await generateProject({
      name: "installed-api",
      cwd: temporaryDirectory,
    });

    installed = result.installed;
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]?.[0]).toEqual(["bun", "install"]);
  } finally {
    spawn.mockRestore();
  }

  expect(installed).toBe(true);
  expect(await Bun.file(join(temporaryDirectory, "installed-api/package.json")).exists()).toBe(
    true,
  );
});

test("propagates a filesystem failure that is not a missing target directory", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-path-error-");
  const blockingFile = join(temporaryDirectory, "blocking-file");
  await Bun.write(blockingFile, "not a directory");
  let thrownError: unknown;

  try {
    await generateProject({
      name: "sample-api",
      cwd: blockingFile,
      skipInstall: true,
    });
  } catch (error) {
    thrownError = error;
  }

  expect(thrownError).toBeInstanceOf(Error);
  expect((thrownError as Error & { readonly code?: string }).code).toBe("ENOTDIR");
});

test.each([
  [["new"], "Project name is required."],
  [["new", "sample-api", "extra"], 'Unexpected argument "extra".'],
  [["new", "sample-api", "--unknown"], 'Unknown option "--unknown".'],
] as const)("rejects invalid new command arguments", (arguments_, message) => {
  expect(() => parseArguments(arguments_)).toThrow(message);
});
