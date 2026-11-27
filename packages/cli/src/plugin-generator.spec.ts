import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readlink, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { generateSchematic, parseArguments } from "./index.ts";
import { checkLibrary } from "./library/check-library.ts";

const repositoryRoot = join(import.meta.dir, "..", "..", "..");
const temporaryDirectories: string[] = [];

const workspaceSources: Readonly<Record<string, string>> = {
  "@aponiajs/common": join(repositoryRoot, "packages", "common", "src", "index.ts"),
  "@aponiajs/core": join(repositoryRoot, "packages", "core", "src", "index.ts"),
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createProjectRoot(prefix: string): Promise<string> {
  // The copy lives outside the workspace: the test rewrites its imports to the
  // workspace sources, so no installed dependency is needed.
  // The temporary directory reports the /var spelling while the module loader
  // reports the canonical /private/var spelling on macOS, so resolve it before
  // rewriting an import to a relative path.
  const projectRoot = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  temporaryDirectories.push(projectRoot);
  return projectRoot;
}

interface PluginProbeReport {
  readonly greeting: string;
  readonly asyncGreeting: string;
  readonly controllerGreeting: string;
  readonly policyNames: readonly string[];
  readonly asyncPolicyNames: readonly string[];
  readonly header: string | null;
}

/**
 * Boots the generated plugin in a child process.
 *
 * The probe runs outside the coverage process so instrumenting a temporary copy
 * of the generated source cannot distort the repository's own coverage report.
 */
async function runGeneratedPlugin(projectRoot: string): Promise<PluginProbeReport> {
  const directory = join(projectRoot, "libs", "widgets", "src");
  await linkWorkspaceImports(directory);
  const probePath = join(projectRoot, "probe.ts");
  await Bun.write(probePath, probeSource(directory));
  const probe = Bun.spawn(["bun", probePath], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    probe.exited,
    new Response(probe.stdout).text(),
    new Response(probe.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error("Generated plugin probe failed: " + stderr);
  }
  return JSON.parse(stdout) as PluginProbeReport;
}

function probeSource(directory: string): string {
  return [
    "import type { DynamicModule } from " +
      JSON.stringify(workspaceSources["@aponiajs/common"]) +
      ";",
    "import { createContainer } from " + JSON.stringify(workspaceSources["@aponiajs/core"]) + ";",
    "import { compileRootModule, resolveHttpPolicies } from " +
      JSON.stringify(workspaceSources["@aponiajs/common"]) +
      ";",
    "const generated = (await import(" + JSON.stringify(join(directory, "index.ts")) + ")) as {",
    "  readonly WidgetsModule: {",
    "    forRoot(options?: { readonly greeting?: string }): DynamicModule;",
    "    forRootAsync(options: {",
    "      readonly useFactory: () => { readonly greeting?: string };",
    "    }): DynamicModule;",
    "  };",
    "  readonly WidgetsService: new (...parameters: never[]) => { greet(): string };",
    "  readonly WidgetsController: new (service: { greet(): string }) => {",
    "    getGreeting(): string;",
    "  };",
    "};",
    "const syncContainer = createContainer(compileRootModule(generated.WidgetsModule.forRoot()));",
    "const asyncContainer = createContainer(",
    "  compileRootModule(",
    '    generated.WidgetsModule.forRootAsync({ useFactory: () => ({ greeting: "Async" }) }),',
    "  ),",
    ");",
    "const policyNames = resolveHttpPolicies(syncContainer).map((policy) => policy.name);",
    "const policy = resolveHttpPolicies(syncContainer)[0];",
    "const response = await policy?.onResponse?.(",
    '  new Request("http://localhost/"),',
    '  new Response("ok"),',
    ");",
    "const controller = new generated.WidgetsController(",
    "  syncContainer.get(generated.WidgetsService),",
    ");",
    "console.log(",
    "  JSON.stringify({",
    "    greeting: syncContainer.get(generated.WidgetsService).greet(),",
    "    asyncGreeting: asyncContainer.get(generated.WidgetsService).greet(),",
    "    controllerGreeting: controller.getGreeting(),",
    "    policyNames,",
    "    asyncPolicyNames: resolveHttpPolicies(asyncContainer).map((policy) => policy.name),",
    '    header: response?.headers.get("x-widgets") ?? null,',
    "  }),",
    ");",
  ].join("\n");
}

/**
 * Points the generated imports at the workspace sources the test itself loads.
 *
 * A generated application resolves these names from its own installed
 * dependencies; a test that skipped the install has none. Rewriting to the same
 * absolute sources keeps one module instance, which matters because the
 * neutral policy provider and the capability requirement are compared by token
 * identity.
 */
async function linkWorkspaceImports(directory: string): Promise<void> {
  for await (const path of new Bun.Glob("**/*.ts").scan({ cwd: directory, onlyFiles: true })) {
    const file = join(directory, path);
    let source = await Bun.file(file).text();
    for (const [specifier, target] of Object.entries(workspaceSources)) {
      const replacement = relative(dirname(file), target).replaceAll("\\", "/");
      source = source.replaceAll(
        `"${specifier}"`,
        `"${replacement.startsWith(".") ? replacement : "./" + replacement}"`,
      );
    }
    await Bun.write(file, source);
  }
}

async function generatePlugin(projectRoot: string): Promise<void> {
  await generateSchematic({
    command: "generate",
    schematic: "plugin",
    name: "widgets",
    dryRun: false,
    skipImport: false,
    crud: false,
    type: "rest",
    publish: true,
    skipInstall: true,
    cwd: projectRoot,
  });
}

describe("aponia g plugin", () => {
  test("parses the plugin schematic and its alias", () => {
    expect(parseArguments(["g", "plugin", "widgets"])).toMatchObject({
      command: "generate",
      schematic: "plugin",
      name: "widgets",
    });
    expect(parseArguments(["g", "pl", "widgets"])).toMatchObject({
      command: "generate",
      schematic: "plugin",
    });
  });

  test("writes the library package surface with a plugin contract", async () => {
    const projectRoot = await createProjectRoot(".aponia-plugin-surface-");
    await generatePlugin(projectRoot);

    const directory = join(projectRoot, "libs", "widgets");
    for (const file of [
      "README.md",
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      "llms.txt",
      "tsconfig.json",
      "tsconfig.build.json",
      "vite.config.ts",
      "tests/widgets.test.ts",
      "tests-vp/widgets.conformance.ts",
      "src/widgets.controller.ts",
      "src/widgets.policy.ts",
    ]) {
      expect(await Bun.file(join(directory, file)).exists(), file).toBe(true);
    }
    expect(await readlink(join(directory, "CLAUDE.md"))).toBe("AGENTS.md");
    expect(await readlink(join(directory, "GEMINI.md"))).toBe("AGENTS.md");

    const manifest = (await Bun.file(join(directory, "aponia.library.json")).json()) as {
      readonly kind: string;
      readonly platforms?: readonly string[];
      readonly provides: readonly { readonly token: string }[];
    };
    expect(manifest.kind).toBe("plugin");
    expect(manifest.platforms).toBeUndefined();
    expect(manifest.provides.map((entry) => entry.token)).toEqual([
      "WidgetsModule",
      "WidgetsService",
      "WidgetsController",
      "WIDGETS_OPTIONS",
    ]);

    const packageJson = (await Bun.file(join(directory, "package.json")).json()) as {
      readonly keywords: readonly string[];
      readonly peerDependencies: Readonly<Record<string, string>>;
    };
    expect(packageJson.keywords).toContain("plugin");

    const checked = await checkLibrary({ cwd: projectRoot, path: "libs/widgets", publish: true });
    expect(checked.issues).toEqual([]);
  });

  test("emits only the neutral contribution contract", async () => {
    const projectRoot = await createProjectRoot(".aponia-plugin-neutral-");
    await generatePlugin(projectRoot);
    const directory = join(projectRoot, "libs", "widgets");

    let source = "";
    for await (const path of new Bun.Glob("src/**/*.ts").scan({
      cwd: directory,
      onlyFiles: true,
    })) {
      source += await Bun.file(join(directory, path)).text();
    }

    const platformDeclaration =
      /providePlatformModule|\bPLATFORM_MODULE\b|\bplatforms\s*:|\badapters\s*:|\b[A-Z_]+_ADAPTER\b/;
    const runtimeImport =
      /from\s+["'](?:elysia|@elysia\/|hono|h3|nitro|@aponiajs\/platform-(?:elysia|hono|h3|nitro))/;
    expect(platformDeclaration.test(source)).toBe(false);
    expect(runtimeImport.test(source)).toBe(false);
    expect(source).toContain("provideHttpPolicyAsync");
    expect(source).toContain('requirePlatformCapabilities(pluginKey, ["http"])');
    expect(source).toContain('@Controller("widgets")');
    expect(await Bun.file(join(directory, "src/adapters/widgets.adapters.ts")).exists()).toBe(
      false,
    );

    for (const file of ["README.md", "AGENTS.md", "llms.txt"]) {
      const text = await Bun.file(join(directory, file)).text();
      expect(text, file).not.toContain("providePlatformModule");
      expect(text, file).not.toContain("adapters/");
      expect(text, file).not.toContain("platforms:");
    }
  });

  test("accepts a scoped plugin name", async () => {
    const projectRoot = await createProjectRoot(".aponia-plugin-scoped-");
    await generateSchematic({
      command: "generate",
      schematic: "plugin",
      name: "@acme/widgets",
      dryRun: false,
      skipImport: false,
      crud: false,
      type: "rest",
      publish: true,
      skipInstall: true,
      cwd: projectRoot,
    });

    const manifest = (await Bun.file(
      join(projectRoot, "libs", "widgets", "package.json"),
    ).json()) as { readonly name: string };
    expect(manifest.name).toBe("@acme/widgets");
  });

  test("writes a private workspace plugin without a publish surface", async () => {
    const projectRoot = await createProjectRoot(".aponia-plugin-private-");
    await generateSchematic({
      command: "generate",
      schematic: "plugin",
      name: "widgets",
      dryRun: false,
      skipImport: false,
      crud: false,
      type: "rest",
      skipInstall: true,
      cwd: projectRoot,
    });

    const manifest = (await Bun.file(
      join(projectRoot, "libs", "widgets", "package.json"),
    ).json()) as {
      readonly private?: boolean;
      readonly dependencies: Readonly<Record<string, string>>;
    };
    expect(manifest.private).toBe(true);
  });

  test("wires a workspace plugin into the application that imports it", async () => {
    const projectRoot = await createProjectRoot(".aponia-plugin-wire-");
    await Bun.write(
      join(projectRoot, "package.json"),
      JSON.stringify(
        {
          name: "workspace",
          private: true,
          workspaces: ["apps/*", "libs/*", "packages/*"],
        },
        undefined,
        2,
      ) + "\n",
    );
    await mkdir(join(projectRoot, "apps", "api"), { recursive: true });
    await Bun.write(
      join(projectRoot, "apps", "api", "package.json"),
      JSON.stringify({ name: "api", private: true }, undefined, 2) + "\n",
    );

    await generateSchematic({
      command: "generate",
      schematic: "plugin",
      name: "widgets",
      dryRun: false,
      skipImport: false,
      crud: false,
      type: "rest",
      skipInstall: true,
      project: "api",
      cwd: projectRoot,
    });

    const application = (await Bun.file(
      join(projectRoot, "apps", "api", "package.json"),
    ).json()) as { readonly dependencies?: Readonly<Record<string, string>> };
    expect(application.dependencies?.["widgets"]).toBeUndefined();

    const configuration = (await Bun.file(join(projectRoot, "aponia-cli.json")).json()) as {
      readonly projects: Readonly<Record<string, { readonly type?: string }>>;
    };
    expect(configuration.projects.widgets?.type).toBe("library");

    const tsconfig = (await Bun.file(join(projectRoot, "tsconfig.json")).json()) as {
      readonly compilerOptions: { readonly paths: Readonly<Record<string, readonly string[]>> };
    };
    expect(tsconfig.compilerOptions.paths["@app/widgets"]).toEqual(["./libs/widgets/src/index.ts"]);

    const rootManifest = (await Bun.file(join(projectRoot, "package.json")).json()) as {
      readonly workspaces: readonly string[];
    };
    expect(rootManifest.workspaces).toEqual(["apps/*", "libs/*"]);
  });

  test.serial("installs a standalone plugin and reports a failed install", async () => {
    const successRoot = await createProjectRoot(".aponia-plugin-install-");
    const spawn = spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(0),
    } as ReturnType<typeof Bun.spawn>);
    try {
      await generateSchematic({
        command: "generate",
        schematic: "plugin",
        name: "widgets",
        dryRun: false,
        skipImport: false,
        crud: false,
        type: "rest",
        publish: true,
        standalone: true,
        skipInstall: false,
        cwd: successRoot,
      });
      expect(spawn.mock.calls[0]?.[0]).toEqual(["bun", "install"]);
    } finally {
      spawn.mockRestore();
    }

    const failureRoot = await createProjectRoot(".aponia-plugin-install-failure-");
    const failingSpawn = spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(23),
    } as ReturnType<typeof Bun.spawn>);
    try {
      let failure: unknown;
      try {
        await generateSchematic({
          command: "generate",
          schematic: "plugin",
          name: "widgets",
          dryRun: false,
          skipImport: false,
          crud: false,
          type: "rest",
          publish: true,
          standalone: true,
          skipInstall: false,
          cwd: failureRoot,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "bun install failed after generating the standalone plugin.",
      );
    } finally {
      failingSpawn.mockRestore();
    }
  });

  test("reports a plugin without writing in a dry run", async () => {
    const projectRoot = await createProjectRoot(".aponia-plugin-dry-");
    const result = await generateSchematic({
      command: "generate",
      schematic: "plugin",
      name: "widgets",
      dryRun: true,
      skipImport: false,
      crud: false,
      type: "rest",
      publish: true,
      skipInstall: true,
      cwd: projectRoot,
    });

    expect(result.changes.some((change) => change.path.endsWith("aponia.library.json"))).toBe(true);
    expect(await Bun.file(join(projectRoot, "libs", "widgets", "package.json")).exists()).toBe(
      false,
    );
  });

  test("boots the generated plugin's neutral contribution", async () => {
    const projectRoot = await createProjectRoot(".aponia-plugin-boot-");
    await generatePlugin(projectRoot);
    const report = await runGeneratedPlugin(projectRoot);

    expect(report.greeting).toBe("Hello from Widgets");
    expect(report.controllerGreeting).toBe("Hello from Widgets");
    expect(report.policyNames).toEqual(["widgets"]);
    expect(report.header).toBe("Hello from Widgets");
  });

  test("forRootAsync builds the options and keeps the contribution", async () => {
    const projectRoot = await createProjectRoot(".aponia-plugin-async-");
    await generatePlugin(projectRoot);
    const report = await runGeneratedPlugin(projectRoot);

    expect(report.asyncGreeting).toBe("Async");
    expect(report.asyncPolicyNames).toEqual(["widgets"]);
  });

  test("runs the generated plugin's own Bun test lane", async () => {
    const projectRoot = await createProjectRoot(".aponia-plugin-self-test-");
    await generatePlugin(projectRoot);
    const directory = join(projectRoot, "libs", "widgets");
    await linkWorkspaceImports(directory);
    const child = Bun.spawn(["bun", "test", "tests/widgets.test.ts"], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    if (exitCode !== 0) {
      throw new Error("Generated plugin tests failed: " + stderr);
    }
    expect(`${stdout}\n${stderr}`).toContain("3 pass");
  });
});
