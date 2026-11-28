import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateProject, parseArguments } from "../index.ts";
import { aponiaVersion } from "../version.ts";

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
  expect(parseArguments(["n", "sample-api", "-d", "-s"])).toMatchObject({
    command: "new",
    name: "sample-api",
    dryRun: true,
    skipInstall: true,
    type: "bun",
    testRunner: "bun",
    minimal: false,
    strict: true,
    skills: ["codex", "claude", "cursor"],
    skipSkills: false,
    skipGit: false,
  });
});

test("parses the module-system and test-runner extensions", () => {
  expect(parseArguments(["new", "sample-api", "--type", "esm"])).toMatchObject({
    type: "esm",
    testRunner: "vitest",
  });
  expect(parseArguments(["new", "sample-api", "--type", "cjs"])).toMatchObject({
    type: "cjs",
    testRunner: "jest",
  });
  expect(
    parseArguments([
      "new",
      "sample-api",
      "--directory",
      "checkout",
      "--package-manager",
      "npm",
      "--collection",
      "@acme/schematics",
      "--no-observe",
    ]),
  ).toMatchObject({
    directory: "checkout",
    packageManager: "npm",
    collection: "@acme/schematics",
    observe: false,
  });
  expect(() => parseArguments(["new", "sample-api", "--type", "deno"])).toThrow(
    'Option "--type" must be "bun", "esm", or "cjs".',
  );
});

test("generates the Bun-first starter into a chosen directory", async () => {
  const temporaryDirectory = await createTemporaryDirectory();
  const result = await generateProject({
    name: "sample-api",
    directory: "checkout",
    cwd: temporaryDirectory,
    skipInstall: true,
    skipGit: true,
    skipSkills: true,
    collection: "@acme/schematics",
  });
  const projectDirectory = join(temporaryDirectory, "checkout");

  expect(result.projectDirectory).toBe(projectDirectory);
  expect(await Bun.file(join(projectDirectory, "aponia-cli.json")).exists()).toBe(true);
  expect(await Bun.file(join(projectDirectory, "aponia.json")).exists()).toBe(false);
  const main = await Bun.file(join(projectDirectory, "src/main.ts")).text();
  expect(main).toContain('from "./app.module.ts"');
  expect(main).not.toContain('".js"');
  const configuration = (await Bun.file(join(projectDirectory, "aponia-cli.json")).json()) as {
    readonly collection?: string;
  };
  expect(configuration.collection).toBe("@acme/schematics");
});

test("emits .js extensions only in the Nest-compatible template sets", async () => {
  const temporaryDirectory = await createTemporaryDirectory();
  await generateProject({
    name: "esm-api",
    cwd: temporaryDirectory,
    skipInstall: true,
    skipGit: true,
    skipSkills: true,
    type: "esm",
    testRunner: "vitest",
  });
  await generateProject({
    name: "cjs-api",
    cwd: temporaryDirectory,
    skipInstall: true,
    skipGit: true,
    skipSkills: true,
    type: "cjs",
    testRunner: "jest",
  });

  const esmMain = await Bun.file(join(temporaryDirectory, "esm-api/src/main.ts")).text();
  const cjsMain = await Bun.file(join(temporaryDirectory, "cjs-api/src/main.ts")).text();
  expect(esmMain).toContain('from "./app.module.js"');
  expect(cjsMain).toContain('from "./app.module"');
  expect(cjsMain).not.toContain('".js"');
  const esmPackage = (await Bun.file(join(temporaryDirectory, "esm-api/package.json")).json()) as {
    readonly scripts: Readonly<Record<string, string>>;
  };
  const cjsPackage = (await Bun.file(join(temporaryDirectory, "cjs-api/package.json")).json()) as {
    readonly scripts: Readonly<Record<string, string>>;
  };
  expect(esmPackage.scripts.test).toBe("vitest run");
  expect(cjsPackage.scripts.test).toBe("jest");
  expect(await Bun.file(join(temporaryDirectory, "esm-api/AGENTS.md")).exists()).toBe(true);
  expect(await readlink(join(temporaryDirectory, "esm-api/CLAUDE.md"))).toBe("AGENTS.md");
  expect(await Bun.file(join(temporaryDirectory, "esm-api/llms.txt")).exists()).toBe(true);
  expect(await Bun.file(join(temporaryDirectory, "cjs-api/AGENTS.md")).exists()).toBe(true);
  expect(await readlink(join(temporaryDirectory, "cjs-api/GEMINI.md"))).toBe("AGENTS.md");
  expect(await Bun.file(join(temporaryDirectory, "cjs-api/llms.txt")).exists()).toBe(true);
});

test("refuses a module-system and test-runner pair that its template set cannot honor", async () => {
  const temporaryDirectory = await createTemporaryDirectory();
  expect(
    generateProject({
      name: "sample-api",
      cwd: temporaryDirectory,
      skipInstall: true,
      type: "esm",
      testRunner: "jest",
    }),
  ).rejects.toThrow(
    '--type esm pairs with --test-runner vitest; "jest" is not supported for that template set.',
  );
});

test("generates a module-controller-service application", async () => {
  const temporaryDirectory = await createTemporaryDirectory();
  const result = await generateProject({
    name: "sample-api",
    cwd: temporaryDirectory,
    skipInstall: true,
    skipGit: true,
    skipSkills: true,
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

test("generates the single-file minimal starter", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-minimal-");
  const result = await generateProject({
    name: "mini",
    cwd: temporaryDirectory,
    skipInstall: true,
    skipGit: true,
    skipSkills: true,
    minimal: true,
  });
  const projectDirectory = join(temporaryDirectory, "mini");

  expect(result.files).toEqual(
    expect.arrayContaining(["package.json", "src/main.ts", "tsconfig.json", "aponia-cli.json"]),
  );
  expect(await Bun.file(join(projectDirectory, "src/app.module.ts")).exists()).toBe(false);
  expect(await Bun.file(join(projectDirectory, "src/main.ts")).text()).toContain(
    "@Module({ controllers: [AppController] })",
  );
  const manifest = (await Bun.file(join(projectDirectory, "package.json")).json()) as {
    readonly scripts: Readonly<Record<string, string>>;
    readonly dependencies: Readonly<Record<string, string>>;
    readonly devDependencies: Readonly<Record<string, string>>;
  };
  expect(manifest.scripts.build).toBeUndefined();
  expect(manifest.dependencies["@aponiajs/devtools"]).toBeUndefined();
  expect(manifest.devDependencies["@aponiajs/cli"]).toBeUndefined();
});

test("generates the Nest-compatible ESM minimal starter and refuses CommonJS", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-esm-minimal-");
  await generateProject({
    name: "mini-esm",
    cwd: temporaryDirectory,
    skipInstall: true,
    skipGit: true,
    skipSkills: true,
    type: "esm",
    testRunner: "vitest",
    minimal: true,
  });
  const projectDirectory = join(temporaryDirectory, "mini-esm");

  expect(await Bun.file(join(projectDirectory, "src/main.ts")).exists()).toBe(true);
  expect(await Bun.file(join(projectDirectory, "src/app.module.ts")).exists()).toBe(false);
  const manifest = (await Bun.file(join(projectDirectory, "package.json")).json()) as {
    readonly scripts: Readonly<Record<string, string>>;
    readonly devDependencies: Readonly<Record<string, string>>;
  };
  expect(manifest.scripts.start).toBe("bun src/main.ts");
  expect(manifest.scripts.test).toBeUndefined();
  expect(manifest.devDependencies.vitest).toBeUndefined();
  expect(manifest.devDependencies["@aponiajs/cli"]).toBeUndefined();

  expect(
    generateProject({
      name: "mini-cjs",
      cwd: temporaryDirectory,
      skipInstall: true,
      type: "cjs",
      testRunner: "jest",
      minimal: true,
    }),
  ).rejects.toThrow("--type cjs cannot be combined with --minimal");
});

test("honors --no-strict in the generated tsconfig", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-strict-");
  await generateProject({
    name: "plain-api",
    cwd: temporaryDirectory,
    skipInstall: true,
    skipGit: true,
    skipSkills: true,
    strict: false,
  });
  const tsconfig = (await Bun.file(join(temporaryDirectory, "plain-api/tsconfig.json")).json()) as {
    readonly compilerOptions: Readonly<Record<string, unknown>>;
  };

  expect(tsconfig.compilerOptions.strict).toBe(false);
});

test("removes the devtools surface when observe is disabled", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-no-observe-");
  await generateProject({
    name: "plain-api",
    cwd: temporaryDirectory,
    skipInstall: true,
    skipGit: true,
    skipSkills: true,
    observe: false,
  });
  const projectDirectory = join(temporaryDirectory, "plain-api");
  const appModule = await Bun.file(join(projectDirectory, "src/app.module.ts")).text();
  const manifest = (await Bun.file(join(projectDirectory, "package.json")).json()) as {
    readonly dependencies: Readonly<Record<string, string>>;
  };

  expect(appModule).not.toContain("@aponiajs/devtools");
  expect(appModule).not.toContain("DevtoolsModule");
  expect(appModule).not.toContain("appLogger");
  expect(appModule).not.toContain("imports:");
  expect(manifest.dependencies["@aponiajs/devtools"]).toBeUndefined();

  // The guide, the index, the environment sample, and the two files that
  // explained why the logger is shared and what the inspection reports are all
  // written for the devtools surface. A project that does not mount it must not
  // ship documentation that says it does.
  for (const file of [
    "README.md",
    "AGENTS.md",
    "llms.txt",
    ".env.example",
    "src/logger.ts",
    "scripts/inspect.ts",
  ]) {
    const content = await Bun.file(join(projectDirectory, file)).text();
    expect(content.toLowerCase()).not.toContain("devtools");
  }
  expect(await Bun.file(join(projectDirectory, ".env.example")).text()).toBe("PORT=3000\n");
});

test("refuses a JavaScript project and uses the requested package manager", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-package-manager-");
  expect(
    generateProject({
      name: "js-api",
      cwd: temporaryDirectory,
      skipInstall: true,
      language: "js",
    }),
  ).rejects.toThrow(
    'The Aponia generator emits TypeScript only; "--language js" is not supported.',
  );

  const spawn = spyOn(Bun, "spawn").mockReturnValue({
    exited: Promise.resolve(0),
  } as ReturnType<typeof Bun.spawn>);
  try {
    await generateProject({
      name: "npm-api",
      cwd: temporaryDirectory,
      skipGit: true,
      skipSkills: true,
      packageManager: "npm",
    });
    expect(spawn.mock.calls[0]?.[0]).toEqual(["npm", "install"]);
  } finally {
    spawn.mockRestore();
  }
});

test("ships agent guidance that names the project and points at the framework", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-agent-guide-");
  await generateProject({
    name: "sample-api",
    cwd: temporaryDirectory,
    skipInstall: true,
    skipGit: true,
    skipSkills: true,
  });
  const projectDirectory = join(temporaryDirectory, "sample-api");

  const guide = await Bun.file(join(projectDirectory, "AGENTS.md")).text();
  const index = await Bun.file(join(projectDirectory, "llms.txt")).text();

  expect(guide).toContain("# sample-api");
  expect(guide).toContain("aponia generate resource users");
  expect(guide).toContain("AponiaFactory.create(AppModule, { logger: false })");
  expect(guide).toContain("imports `@aponiajs/devtools` in `src/app.module.ts`");
  expect(index).toContain("# sample-api");
  expect(index).toContain("](./AGENTS.md)");
  expect(await readlink(join(projectDirectory, "CLAUDE.md"))).toBe("AGENTS.md");
  expect(await readlink(join(projectDirectory, "GEMINI.md"))).toBe("AGENTS.md");
});

test("ships a runnable inspection script wired into the manifest", async () => {
  const temporaryDirectory = await createTemporaryDirectory("aponia-inspect-");
  await generateProject({
    name: "sample-api",
    cwd: temporaryDirectory,
    skipInstall: true,
    skipGit: true,
    skipSkills: true,
  });
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
  await generateProject({
    name: "sample-api",
    cwd: temporaryDirectory,
    skipInstall: true,
    skipGit: true,
    skipSkills: true,
  });
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
  await generateProject({
    name: "sample-api",
    cwd: temporaryDirectory,
    skipInstall: true,
    skipGit: true,
    skipSkills: true,
  });
  const projectDirectory = join(temporaryDirectory, "sample-api");

  // `bun run dev`, `bun start`, and `bun test` import the sources directly, so
  // they must not need a build to have run. The entrypoint has zero leaked
  // artifact imports because the invisible compiler runs in memory.
  const main = await Bun.file(join(projectDirectory, "src/main.ts")).text();
  expect(main).toContain("AponiaFactory.create(AppModule");
  expect(main).not.toContain("descriptors.generated.ts");
  expect(main).not.toContain("invokers.generated.ts");
  expect(await Bun.file(join(projectDirectory, "src/invokers.generated.ts")).exists()).toBe(true);
  expect(await Bun.file(join(projectDirectory, "src/descriptors.generated.ts")).exists()).toBe(
    true,
  );
  expect(await Bun.file(join(projectDirectory, "bunfig.toml")).text()).toContain(
    'preload = ["@aponiajs/platform-elysia/register"]',
  );
});

test("indexes framework documentation that exists beside this template", async () => {
  const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
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
        skipGit: true,
        skipSkills: true,
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe("bun install failed with exit code 23.");
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
      skipGit: true,
      skipSkills: true,
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
