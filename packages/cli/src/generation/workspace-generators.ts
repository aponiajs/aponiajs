import { mkdir, readdir, rm } from "node:fs/promises";
import { constantCase } from "change-case";
import { join } from "node:path";
import { aponiaVersion } from "../version.ts";
import type { ComponentNames } from "../interfaces/component-names.interface.ts";
import { createAgentGuideLinks, createFile, writePendingFiles } from "./file-writer.ts";
import { generateProject } from "./project-generator.ts";
import type {
  GenerateSchematicOptions,
  GenerateSchematicResult,
  PendingFile,
} from "../interfaces/schematic.interface.ts";

/** The package a generator writes: a Nest-style module library or a plugin. */
type PackageKind = "module" | "plugin";

export async function generateApplication(
  projectRoot: string,
  name: string,
  options: GenerateSchematicOptions,
): Promise<GenerateSchematicResult> {
  const appsDirectory = join(projectRoot, "apps");
  if (!options.dryRun) {
    await mkdir(appsDirectory, { recursive: true });
  }
  const result = await generateProject({
    name,
    cwd: appsDirectory,
    dryRun: options.dryRun,
    skipInstall: true,
    skipGit: true,
    skipSkills: true,
    type: "bun",
    testRunner: "bun",
    strict: options.strict ?? true,
  });

  const files = result.files.map((file) => toAppFile(file));
  if (!options.dryRun) {
    await renameAppTsconfig(projectRoot, join(appsDirectory, name));
    await registerWorkspaceProject(projectRoot, name, "application");
  }
  return {
    dryRun: options.dryRun,
    changes: files.map((file) => ({ kind: "CREATE", path: join("apps", name, file) })),
  };
}

function toAppFile(file: string): string {
  return file === "tsconfig.json" ? "tsconfig.app.json" : file;
}

async function renameAppTsconfig(projectRoot: string, appDirectory: string): Promise<void> {
  const source = Bun.file(join(appDirectory, "tsconfig.json"));
  if (!(await source.exists())) {
    return;
  }
  const rootTsconfigExists = await Bun.file(join(projectRoot, "tsconfig.json")).exists();
  const content = await source.text();
  await Bun.write(
    join(appDirectory, "tsconfig.app.json"),
    rootTsconfigExists ? content.replace(/^\{/, `{\n  "extends": "../../tsconfig.json",`) : content,
  );
  await rm(join(appDirectory, "tsconfig.json"), { force: true });
  const buildFile = Bun.file(join(appDirectory, "tsconfig.build.json"));
  if (await buildFile.exists()) {
    await Bun.write(
      join(appDirectory, "tsconfig.build.json"),
      (await buildFile.text()).replace(
        '"extends": "./tsconfig.json"',
        '"extends": "./tsconfig.app.json"',
      ),
    );
  }
}

async function ensureWorkspaceRoot(projectRoot: string, workspaceGlob: string): Promise<void> {
  const tsconfigPath = join(projectRoot, "tsconfig.json");
  if (!(await Bun.file(tsconfigPath).exists())) {
    await Bun.write(tsconfigPath, `${JSON.stringify({ compilerOptions: {} }, undefined, 2)}\n`);
  }

  const manifestPath = join(projectRoot, "package.json");
  const manifestFile = Bun.file(manifestPath);
  const manifest = (await manifestFile.exists())
    ? ((await manifestFile.json()) as {
        readonly workspaces?: readonly string[];
        readonly [key: string]: unknown;
      })
    : { name: "workspace", private: true, type: "module" };
  const workspaces = [...new Set([...(manifest.workspaces ?? []), workspaceGlob])].toSorted();
  await Bun.write(manifestPath, `${JSON.stringify({ ...manifest, workspaces }, undefined, 2)}\n`);
}

async function registerWorkspaceProject(
  projectRoot: string,
  name: string,
  type: "application" | "library",
): Promise<void> {
  await ensureWorkspaceRoot(projectRoot, `${type === "application" ? "apps" : "libs"}/*`);
  const configurationPath = join(projectRoot, "aponia-cli.json");
  const configurationFile = Bun.file(configurationPath);
  const configuration = (await configurationFile.exists())
    ? ((await configurationFile.json()) as Record<string, unknown>)
    : {
        collection: "@aponiajs/schematics",
        sourceRoot: "src",
        entryFile: "main",
        language: "ts",
        compilerOptions: { deleteOutDir: true },
      };
  const projects = (configuration.projects as Record<string, unknown> | undefined) ?? {};
  const root = `${type === "application" ? "apps" : "libs"}/${name}`;
  const entryFile = type === "application" ? "main" : "index";
  const tsConfigPath =
    type === "application" ? `${root}/tsconfig.app.json` : `${root}/tsconfig.lib.json`;
  await Bun.write(
    configurationPath,
    `${JSON.stringify(
      {
        ...configuration,
        monorepo: true,
        projects: {
          ...projects,
          [name]: {
            type,
            root,
            entryFile,
            sourceRoot: `${root}/src`,
            compilerOptions: { tsConfigPath },
          },
        },
      },
      undefined,
      2,
    )}\n`,
  );
}

export async function generateLibrary(
  projectRoot: string,
  names: ComponentNames,
  options: GenerateSchematicOptions,
): Promise<GenerateSchematicResult> {
  return generatePackage(projectRoot, names, options, "module");
}

export async function generatePlugin(
  projectRoot: string,
  names: ComponentNames,
  options: GenerateSchematicOptions,
): Promise<GenerateSchematicResult> {
  return generatePackage(projectRoot, names, options, "plugin");
}

async function generatePackage(
  projectRoot: string,
  names: ComponentNames,
  options: GenerateSchematicOptions,
  kind: PackageKind,
): Promise<GenerateSchematicResult> {
  const standalone = options.standalone === true;
  const directory = standalone
    ? join(projectRoot, names.fileName)
    : join(projectRoot, "libs", names.fileName);
  const publish = options.publish === true;
  const scope = options.scope?.trim().replace(/^@/, "");
  const packageName = scope ? `@${scope}/${names.fileName}` : names.fileName;

  const files = createPackageFiles({
    directory,
    names,
    kind,
    publish,
    packageName,
    standalone,
  });
  const result = await writePendingFiles(projectRoot, files, options.dryRun);
  if (!options.dryRun && !standalone) {
    await wireWorkspaceLibrary(projectRoot, names, packageName, options, kind);
  }
  if (!options.dryRun && standalone && options.skipInstall !== true) {
    const install = Bun.spawn(["bun", "install"], {
      cwd: directory,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await install.exited) !== 0) {
      throw new Error(`bun install failed after generating the standalone ${kind}.`);
    }
  }
  return result;
}

/** Everything one package scaffold needs: where it goes and what it is. */
interface PackageSpec {
  readonly directory: string;
  readonly names: ComponentNames;
  readonly kind: PackageKind;
  readonly publish: boolean;
  readonly packageName: string;
  readonly standalone: boolean;
}

function createPackageFiles(spec: PackageSpec): PendingFile[] {
  const { directory, names, kind, publish, packageName, standalone } = spec;
  const optionsToken = `${constantCase(names.className)}_OPTIONS`;
  const label = kind === "plugin" ? "plugin" : "library";
  const keywords = [
    "aponia",
    "aponiajs",
    "aponia-library",
    ...(kind === "plugin" ? ["plugin"] : []),
  ];
  const manifest = {
    contractVersion: 1,
    name: packageName,
    kind,
    framework: { aponia: aponiaVersion, bun: ">=1.4.4" },
    entrypoints: [
      {
        subpath: ".",
        module: "./dist/index.mjs",
        types: "./dist/index.d.mts",
      },
    ],
    provides: [
      { kind: "module", token: `${names.className}Module` },
      { kind: "provider", token: `${names.className}Service` },
      ...(kind === "plugin" ? [{ kind: "controller", token: `${names.className}Controller` }] : []),
      { kind: "provider", token: optionsToken },
    ],
    requires: [],
    security: { network: false, filesystem: false, postinstall: false, permissions: [] },
  } as const;

  return [
    createFile(
      directory,
      "package.json",
      `${JSON.stringify(
        {
          name: packageName,
          version: publish ? "0.1.0" : "0.0.0",
          description: `${names.className} ${label} for AponiaJS.`,
          license: "MIT",
          keywords,
          packageManager: "bun@1.4.5",
          type: "module",
          sideEffects: false,
          ...(publish
            ? {
                files: ["dist", "llms.txt", "aponia.library.json"],
                exports: {
                  ".": {
                    types: "./dist/index.d.mts",
                    import: "./dist/index.mjs",
                  },
                  "./package.json": "./package.json",
                },
                publishConfig: { access: "public" },
              }
            : { private: true }),
          scripts: {
            build: "bunx --bun vp pack",
            dev: "bunx --bun vp pack --watch",
            test: "bun test",
            "test:vite-plus": "vp test",
            check: "bunx --bun vp check",
            prepublishOnly: "bun run build",
          },
          ...(publish
            ? { peerDependencies: packagePeerDependencies(kind) }
            : { dependencies: packageDependencies(kind) }),
          devDependencies: {
            "@aponiajs/common": aponiaVersion,
            "@aponiajs/core": aponiaVersion,
            typescript: "^7.0.2",
            "vite-plus": "^1.5.0",
          },
        },
        undefined,
        2,
      )}\n`,
    ),
    createFile(directory, "tsconfig.json", packageTsconfig()),
    createFile(
      directory,
      "tsconfig.lib.json",
      packageLibTsconfig(standalone ? undefined : "../../tsconfig.json"),
    ),
    createFile(directory, "tsconfig.build.json", packageBuildTsconfig()),
    createFile(directory, "vite.config.ts", packageViteConfig()),
    createFile(directory, "README.md", packageReadme(spec)),
    createFile(directory, "AGENTS.md", packageAgents(names, kind)),
    ...createAgentGuideLinks(directory),
    createFile(directory, "llms.txt", packageLlms(names, kind)),
    createFile(directory, "aponia.library.json", `${JSON.stringify(manifest, undefined, 2)}\n`),
    createFile(join(directory, "src"), `${names.fileName}.types.ts`, packageTypes(names, kind)),
    createFile(
      join(directory, "src"),
      `${names.fileName}.constants.ts`,
      packageConstants(names, optionsToken),
    ),
    createFile(
      join(directory, "src"),
      `${names.fileName}.module.ts`,
      packageModule(names, kind, optionsToken),
    ),
    createFile(
      join(directory, "src"),
      `${names.fileName}.service.ts`,
      packageService(names, kind, optionsToken),
    ),
    ...(kind === "plugin"
      ? [
          createFile(
            join(directory, "src"),
            `${names.fileName}.controller.ts`,
            packageController(names),
          ),
          createFile(join(directory, "src"), `${names.fileName}.policy.ts`, packagePolicy(names)),
        ]
      : []),
    createFile(join(directory, "tests"), `${names.fileName}.test.ts`, packageTests(names, kind)),
    createFile(
      join(directory, "tests-vp"),
      `${names.fileName}.conformance.ts`,
      packageConformance(names, kind),
    ),
    createFile(join(directory, "src"), "index.ts", packageBarrel(names, optionsToken, kind)),
  ];
}

function packageDependencies(_kind: PackageKind): Readonly<Record<string, string>> {
  return {
    "@aponiajs/common": aponiaVersion,
  };
}

function packagePeerDependencies(_kind: PackageKind): Readonly<Record<string, string>> {
  return {
    "@aponiajs/common": `^${aponiaVersion}`,
  };
}

function packageTypes(names: ComponentNames, kind: PackageKind): string {
  const asyncOptions = `/** The options ${names.className}Module.forRootAsync accepts. */
export interface ${names.className}ModuleAsyncOptions {
  /** The modules whose exported providers the factory injects. */
  readonly imports?: readonly ModuleImport[];
  /** The tokens the factory injects, resolved from the imports. */
  readonly inject?: readonly InjectionDependency[];
  /** Builds the options from the injected dependencies. */
  readonly useFactory: (...dependencies: readonly unknown[]) => ${names.className}ModuleOptions;
}`;

  if (kind === "plugin") {
    return `import type { InjectionDependency, ModuleImport } from "@aponiajs/common";

/**
 * The options ${names.className}Module.forRoot accepts.
 *
 * The module contributes these options to a controller and an HTTP policy. Its
 * source is runtime-neutral, so every registration runs on any platform that
 * has the \`http\` capability.
 */
export interface ${names.className}ModuleOptions {
  /** The greeting the service and the controller answer. */
  readonly greeting?: string;
}

${asyncOptions}
`;
  }

  return `import type { InjectionDependency, ModuleImport } from "@aponiajs/common";

/** The options ${names.className}Module.forRoot accepts. */
export interface ${names.className}ModuleOptions {
  /** The greeting the service answers; defaults to "Hello from ${names.className}". */
  readonly greeting?: string;
}

${asyncOptions}
`;
}

function packageConstants(names: ComponentNames, optionsToken: string): string {
  return `import { createToken } from "@aponiajs/common";\nimport type { ${names.className}ModuleOptions } from "./${names.fileName}.types.ts";\n\n/** The options token the module provides and the service injects. */\nexport const ${optionsToken} = createToken<${names.className}ModuleOptions>("${optionsToken}");\n`;
}

function packageModule(names: ComponentNames, kind: PackageKind, optionsToken: string): string {
  if (kind === "plugin") {
    return `import {
  Module,
  dynamicModule,
  provideFactory,
  provideValue,
  type DynamicModule,
  type ModuleImport,
  type Provider,
} from "@aponiajs/common";
import {
  provideHttpPolicyAsync,
  requirePlatformCapabilities,
} from "@aponiajs/common";
import { ${optionsToken} } from "./${names.fileName}.constants.ts";
import { ${names.className}Controller } from "./${names.fileName}.controller.ts";
import { build${names.className}Policy } from "./${names.fileName}.policy.ts";
import { ${names.className}Service } from "./${names.fileName}.service.ts";
import type {
  ${names.className}ModuleAsyncOptions,
  ${names.className}ModuleOptions,
} from "./${names.fileName}.types.ts";

/** The registration key the plugin declares and the graph distinguishes it by. */
const pluginKey = "${names.fileName}";

/**
 * Registers the ${names.className} plugin.
 *
 * The module is runtime-neutral: it contributes a controller, an HTTP policy,
 * the service, and the \`http\` capability requirement through the shared
 * contracts. Its source imports no platform package and no HTTP runtime, so the
 * same registration runs wherever the platform has that capability.
 *
 * One registration per application is the supported shape: the registration key
 * is the module identity, so two registrations that share it fail with
 * \`DUPLICATE_MODULE\` rather than one silently replacing the other.
 */
@Module({})
export class ${names.className}Module {
  /**
   * Registers the plugin with literal options.
   *
   * @param options - The greeting the service and controller answer with.
   * @returns The dynamic module an application imports.
   */
  static forRoot(options: ${names.className}ModuleOptions = {}): DynamicModule {
    return registration([provideValue(${optionsToken}, Object.freeze({ ...options }))]);
  }

  /**
   * Registers the plugin with options a factory builds.
   *
   * The factory runs synchronously in this release; an async factory is not
   * awaited by the container.
   *
   * @param options - The imports, injected tokens, and factory.
   * @returns The dynamic module an application imports.
   */
  static forRootAsync(options: ${names.className}ModuleAsyncOptions): DynamicModule {
    return registration(
      [provideFactory(${optionsToken}, options.inject ?? [], options.useFactory)],
      options.imports,
    );
  }
}

function registration(
  optionsProviders: readonly Provider[],
  imports: readonly ModuleImport[] = [],
): DynamicModule {
  return dynamicModule({
    module: ${names.className}Module,
    id: "${names.className}Module[" + pluginKey + "]",
    instanceId: Symbol.for("aponia.plugin.${names.fileName}:" + pluginKey),
    imports: [...imports],
    providers: [
      ...optionsProviders,
      ${names.className}Service,
      provideHttpPolicyAsync([${optionsToken}], (options: ${names.className}ModuleOptions) =>
        build${names.className}Policy(options),
      ),
      requirePlatformCapabilities(pluginKey, ["http"]),
    ],
    controllers: [${names.className}Controller],
    exports: [${names.className}Service, ${optionsToken}],
  });
}
`;
  }

  return `import {\n  Module,\n  dynamicModule,\n  provideFactory,\n  provideValue,\n  type DynamicModule,\n} from "@aponiajs/common";\nimport { ${optionsToken} } from "./${names.fileName}.constants.ts";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\nimport type {\n  ${names.className}ModuleAsyncOptions,\n  ${names.className}ModuleOptions,\n} from "./${names.fileName}.types.ts";\n\n/**\n * Registers the ${names.className} providers.\n *\n * The module is runtime-neutral: it imports nothing from a platform, so the\n * same registration runs on every platform the application boots on.\n */\n@Module({})\nexport class ${names.className}Module {\n  /**\n   * Registers the module with literal options.\n   *\n   * @param options - The greeting the service answers with.\n   * @returns The dynamic module an application imports.\n   */\n  static forRoot(options: ${names.className}ModuleOptions = {}): DynamicModule {\n    return dynamicModule({\n      module: ${names.className}Module,\n      providers: [\n        provideValue(${optionsToken}, Object.freeze({ ...options })),\n        ${names.className}Service,\n      ],\n      exports: [${names.className}Service, ${optionsToken}],\n    });\n  }\n\n  /**\n   * Registers the module with options a factory builds.\n   *\n   * The factory runs synchronously in this release; an async factory is not\n   * awaited by the container.\n   *\n   * @param options - The imports, injected tokens, and factory.\n   * @returns The dynamic module an application imports.\n   */\n  static forRootAsync(options: ${names.className}ModuleAsyncOptions): DynamicModule {\n    return dynamicModule({\n      module: ${names.className}Module,\n      imports: [...(options.imports ?? [])],\n      providers: [\n        provideFactory(${optionsToken}, options.inject ?? [], options.useFactory),\n        ${names.className}Service,\n      ],\n      exports: [${names.className}Service, ${optionsToken}],\n    });\n  }\n}\n`;
}

function packageService(names: ComponentNames, kind: PackageKind, optionsToken: string): string {
  const description =
    kind === "plugin" ? "The injectable the plugin exports." : "The injectable the module exports.";
  return `import { Inject, Injectable, Optional } from "@aponiajs/common";\nimport { ${optionsToken} } from "./${names.fileName}.constants.ts";\nimport type { ${names.className}ModuleOptions } from "./${names.fileName}.types.ts";\n\n/** ${description} */\n@Injectable()\nexport class ${names.className}Service {\n  readonly #options: ${names.className}ModuleOptions;\n\n  constructor(@Optional() @Inject(${optionsToken}) options?: ${names.className}ModuleOptions) {\n    this.#options = options ?? {};\n  }\n\n  /** Answers the greeting the registration chose, or the default. */\n  greet(): string {\n    return this.#options.greeting ?? "Hello from ${names.className}";\n  }\n}\n`;
}

function packageController(names: ComponentNames): string {
  return `import { Controller, Get } from "@aponiajs/common";
import { ${names.className}Service } from "./${names.fileName}.service.ts";

/** The route the plugin contributes to every application that registers it. */
@Controller("${names.fileName}")
export class ${names.className}Controller {
  constructor(private readonly ${names.propertyName}Service: ${names.className}Service) {}

  /** Answers the greeting the registration chose. */
  @Get()
  getGreeting(): string {
    return this.${names.propertyName}Service.greet();
  }
}
`;
}

function packagePolicy(names: ComponentNames): string {
  return `import type { HttpPolicy } from "@aponiajs/common";
import type { ${names.className}ModuleOptions } from "./${names.fileName}.types.ts";

/**
 * The neutral HTTP policy the plugin contributes.
 *
 * The shared request pipeline runs it on every platform, so the plugin never
 * touches a native request or response object. This example adds the
 * registration's greeting to every response.
 */
export function build${names.className}Policy(options: ${names.className}ModuleOptions): HttpPolicy {
  const greeting = options.greeting ?? "Hello from ${names.className}";
  return {
    name: "${names.fileName}",
    onResponse(_request, response) {
      const headers = new Headers(response.headers);
      headers.set("x-${names.fileName}", greeting);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}
`;
}

function packageTests(names: ComponentNames, kind: PackageKind): string {
  if (kind === "plugin") {
    return `import { describe, expect, test } from "bun:test";
import { createContainer } from "@aponiajs/core";
import { compileRootModule, resolveHttpPolicies } from "@aponiajs/common";
import {
  ${names.className}Controller,
  ${names.className}Module,
  ${names.className}Service,
} from "../src/index.ts";

/**
 * Resolves the registration from the module graph alone.
 *
 * No HTTP platform is booted: the module, the controller it declares, and the
 * policy it contributes are the whole contract a plugin needs, which is what
 * keeps this test true on every platform.
 */
function containerFor(registration: ReturnType<typeof ${names.className}Module.forRoot>) {
  return createContainer(compileRootModule(registration));
}

describe("${names.className}Module", () => {
  test("contributes the service, controller, and HTTP policy", async () => {
    const container = containerFor(${names.className}Module.forRoot({ greeting: "Hi" }));
    expect(container.get(${names.className}Service).greet()).toBe("Hi");

    const controller = new ${names.className}Controller(container.get(${names.className}Service));
    expect(controller.getGreeting()).toBe("Hi");

    const policies = resolveHttpPolicies(container);
    expect(policies.map((policy) => policy.name)).toEqual(["${names.fileName}"]);
    const response = await policies[0]?.onResponse?.(
      new Request("http://localhost/"),
      new Response("ok"),
    );
    expect(response?.headers.get("x-${names.fileName}")).toBe("Hi");
  });

  test("forRootAsync builds the options and keeps the contribution", () => {
    const container = containerFor(
      ${names.className}Module.forRootAsync({ useFactory: () => ({ greeting: "Async" }) }),
    );
    expect(container.get(${names.className}Service).greet()).toBe("Async");
    expect(resolveHttpPolicies(container).map((policy) => policy.name)).toEqual([
      "${names.fileName}",
    ]);
  });

  test("falls back to the default greeting", () => {
    const service = containerFor(${names.className}Module.forRoot()).get(${names.className}Service);
    expect(service.greet()).toBe("Hello from ${names.className}");
  });
});
`;
  }

  return `import { describe, expect, test } from "bun:test";\nimport { createContainer } from "@aponiajs/core";\nimport { compileRootModule } from "@aponiajs/common";\nimport { ${names.className}Module, ${names.className}Service } from "../src/index.ts";\n\n/**\n * Resolves the service from the module graph alone.\n *\n * No HTTP platform is booted: the container is the whole contract a library\n * needs, which is what keeps this test true on every platform.\n */\nfunction resolve(registration: ReturnType<typeof ${names.className}Module.forRoot>) {\n  return createContainer(compileRootModule(registration)).get(${names.className}Service);\n}\n\ndescribe("${names.className}Module", () => {\n  test("forRoot provides its options to the service", () => {\n    expect(resolve(${names.className}Module.forRoot({ greeting: "Hi" })).greet()).toBe("Hi");\n  });\n\n  test("forRootAsync builds the options from a factory", () => {\n    expect(\n      resolve(\n        ${names.className}Module.forRootAsync({ useFactory: () => ({ greeting: "Async" }) }),\n      ).greet(),\n    ).toBe("Async");\n  });\n\n  test("falls back to the default greeting", () => {\n    expect(resolve(${names.className}Module.forRoot()).greet()).toBe(\n      "Hello from ${names.className}",\n    );\n  });\n});\n`;
}

function packageConformance(names: ComponentNames, kind: PackageKind): string {
  if (kind === "plugin") {
    return `import { createContainer } from "@aponiajs/core";
import { compileRootModule, resolveHttpPolicies } from "@aponiajs/common";
import {
  ${names.className}Controller,
  ${names.className}Module,
  ${names.className}Service,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("resolves the service, controller, and HTTP policy from the module graph", () => {
  const container = createContainer(
    compileRootModule(${names.className}Module.forRoot({ greeting: "Conformance" })),
  );
  expect(container.get(${names.className}Service).greet()).toBe("Conformance");
  expect(
    new ${names.className}Controller(container.get(${names.className}Service)).getGreeting(),
  ).toBe("Conformance");
  expect(resolveHttpPolicies(container).map((policy) => policy.name)).toEqual([
    "${names.fileName}",
  ]);
});
`;
  }

  return `import { createContainer } from "@aponiajs/core";\nimport { compileRootModule } from "@aponiajs/common";\nimport { ${names.className}Module, ${names.className}Service } from "../src/index.ts";\n\ntype VitePlusTest = typeof import("vite-plus/test");\n\ndeclare const test: VitePlusTest["test"];\ndeclare const expect: VitePlusTest["expect"];\n\ntest("resolves the service from the module graph", () => {\n  const container = createContainer(\n    compileRootModule(${names.className}Module.forRoot({ greeting: "Conformance" })),\n  );\n  expect(container.get(${names.className}Service).greet()).toBe("Conformance");\n});\n`;
}

function packageBarrel(names: ComponentNames, optionsToken: string, kind: PackageKind): string {
  const controller =
    kind === "plugin"
      ? `export { ${names.className}Controller } from "./${names.fileName}.controller.ts";\n`
      : "";
  return `export { ${names.className}Module } from "./${names.fileName}.module.ts";\n${controller}export { ${names.className}Service } from "./${names.fileName}.service.ts";\nexport { ${optionsToken} } from "./${names.fileName}.constants.ts";\nexport type {\n  ${names.className}ModuleAsyncOptions,\n  ${names.className}ModuleOptions,\n} from "./${names.fileName}.types.ts";\n`;
}

async function wireWorkspaceLibrary(
  projectRoot: string,
  names: ComponentNames,
  packageName: string,
  options: GenerateSchematicOptions,
  kind: PackageKind,
): Promise<void> {
  const rootManifestPath = join(projectRoot, "package.json");
  const rootFile = Bun.file(rootManifestPath);
  const rootManifest = (await rootFile.exists())
    ? ((await rootFile.json()) as {
        readonly workspaces?: readonly string[];
        readonly [key: string]: unknown;
      })
    : {
        name: "workspace",
        private: true,
        type: "module",
      };
  const workspaces = [...new Set([...(rootManifest.workspaces ?? []), "libs/*"])].filter(
    (entry) => entry !== "packages/*",
  );
  await Bun.write(
    rootManifestPath,
    `${JSON.stringify({ ...rootManifest, workspaces }, undefined, 2)}\n`,
  );

  const configurationPath = join(projectRoot, "aponia-cli.json");
  const configurationFile = Bun.file(configurationPath);
  const configuration = (await configurationFile.exists())
    ? ((await configurationFile.json()) as Record<string, unknown>)
    : {
        collection: "@aponiajs/schematics",
        sourceRoot: "src",
        entryFile: "main",
        language: "ts",
        compilerOptions: { deleteOutDir: true },
      };
  const configuredPrefix =
    options.prefix ??
    (typeof configuration.defaultLibraryPrefix === "string"
      ? configuration.defaultLibraryPrefix
      : undefined);
  const prefix =
    configuredPrefix === undefined
      ? "@app"
      : configuredPrefix.startsWith("@")
        ? configuredPrefix
        : `@${configuredPrefix}`;
  const libraryRoot = `libs/${names.fileName}`;
  const projects = {
    ...(configuration.projects as Record<string, unknown> | undefined),
    [names.fileName]: {
      type: "library",
      root: libraryRoot,
      entryFile: "index",
      sourceRoot: `${libraryRoot}/src`,
      compilerOptions: { tsConfigPath: `${libraryRoot}/tsconfig.lib.json` },
    },
  };
  await Bun.write(
    configurationPath,
    `${JSON.stringify(
      {
        ...configuration,
        monorepo: true,
        defaultLibraryPrefix: prefix,
        projects,
      },
      undefined,
      2,
    )}\n`,
  );

  const tsconfigPath = join(projectRoot, "tsconfig.json");
  const tsconfigFile = Bun.file(tsconfigPath);
  const tsconfig = (await tsconfigFile.exists())
    ? ((await tsconfigFile.json()) as Record<string, unknown>)
    : { compilerOptions: {} };
  const compilerOptions = (tsconfig.compilerOptions as Record<string, unknown> | undefined) ?? {};
  const paths = {
    ...(compilerOptions.paths as Record<string, readonly string[]> | undefined),
    [`${prefix}/${names.fileName}`]: [`./${libraryRoot}/src/index.ts`],
    [`${prefix}/${names.fileName}/*`]: [`./${libraryRoot}/src/*`],
  };
  await Bun.write(
    tsconfigPath,
    `${JSON.stringify(
      { ...tsconfig, compilerOptions: { ...compilerOptions, paths } },
      undefined,
      2,
    )}\n`,
  );

  const appsDirectory = join(projectRoot, "apps");
  const apps = await readdir(appsDirectory, { withFileTypes: true }).catch(() => []);
  const projectName = options.project ?? apps.find((entry) => entry.isDirectory())?.name;
  const targetPath =
    projectName === undefined ? rootManifestPath : join(appsDirectory, projectName, "package.json");
  const targetFile = Bun.file(targetPath);
  if (!(await targetFile.exists())) {
    throw new Error(`Cannot find the application manifest for "${projectName ?? "the root app"}".`);
  }
  const target = (await targetFile.json()) as {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly [key: string]: unknown;
  };
  if (options.publish === true) {
    await Bun.write(
      targetPath,
      `${JSON.stringify(
        { ...target, dependencies: { ...target.dependencies, [packageName]: "workspace:*" } },
        undefined,
        2,
      )}\n`,
    );
  }

  if (options.skipInstall !== true) {
    const install = Bun.spawn(["bun", "install"], {
      cwd: projectRoot,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await install.exited) !== 0) {
      throw new Error(`bun install failed after generating the workspace ${kind}.`);
    }
  }
}

function packageTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ESNext",
        lib: ["ESNext"],
        moduleDetection: "force",
        module: "Preserve",
        moduleResolution: "Bundler",
        resolveJsonModule: true,
        types: ["bun"],
        strict: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        noUnusedLocals: true,
        declaration: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        isolatedModules: true,
        verbatimModuleSyntax: true,
        skipLibCheck: true,
      },
      include: ["src", "tests", "tests-vp"],
    },
    undefined,
    2,
  )}\n`;
}

function packageBuildTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ESNext",
        lib: ["ESNext"],
        moduleDetection: "force",
        module: "Preserve",
        moduleResolution: "Bundler",
        resolveJsonModule: true,
        types: ["bun"],
        strict: true,
        noUnusedLocals: true,
        declaration: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        isolatedModules: true,
        verbatimModuleSyntax: true,
        skipLibCheck: true,
      },
      include: ["src"],
    },
    undefined,
    2,
  )}\n`;
}

function packageViteConfig(): string {
  return `import { defineConfig } from "vite-plus";\n\nexport default defineConfig({\n  test: {\n    globals: true,\n    include: ["tests-vp/**/*.conformance.ts"],\n  },\n  pack: {\n    tsconfig: "tsconfig.lib.json",\n    dts: true,\n    exports: true,\n    deps: {\n      neverBundle: ["@aponiajs/common", "@aponiajs/core"],\n    },\n  },\n  lint: {\n    options: {\n      typeAware: true,\n      typeCheck: true,\n    },\n  },\n  fmt: {},\n});\n`;
}

function packageLibTsconfig(extendsPath: string | undefined): string {
  return `${JSON.stringify(
    {
      ...(extendsPath === undefined ? {} : { extends: extendsPath }),
      compilerOptions: {
        rootDir: "src",
        outDir: "dist",
        declaration: true,
        noEmit: false,
      },
      include: ["src"],
    },
    undefined,
    2,
  )}\n`;
}

function packageReadme(spec: PackageSpec): string {
  const { names, kind, publish, packageName } = spec;
  const label = kind === "plugin" ? "plugin" : "library";
  const command = kind === "plugin" ? "aponia g plugin" : "aponia g library";
  const contributionSection =
    kind === "plugin"
      ? `\n## Contributions\n\nThe plugin is runtime-neutral. Its module contributes a controller, the \`${names.fileName}\` HTTP policy, the service, and the \`http\` capability requirement through the shared contracts. It imports no platform package and no HTTP runtime, so the same registration runs wherever the platform has \`http\`; a platform without it refuses the boot with \`UNSUPPORTED_PLATFORM_FEATURE\` before anything mounts.\n\nOne registration per application is the supported shape: the registration key is the module identity, so two registrations that share it fail with \`DUPLICATE_MODULE\`.\n`
      : "";
  const neutrality =
    kind === "plugin"
      ? "wherever the platform has the capabilities it requires"
      : "on every Aponia platform";
  return `# ${packageName}\n\n${publish ? "A publishable" : "A private workspace"} AponiaJS ${label} generated by \`${command}\`.\n\n## Use it\n\n\`\`\`ts\nimport { Module } from "@aponiajs/common";\nimport { ${names.className}Module } from "${packageName}";\n\n@Module({ imports: [${names.className}Module.forRoot({ greeting: "Hi" })] })\nexport class AppModule {}\n\`\`\`\n\n\`forRootAsync\` builds the same options from a factory with injected dependencies:\n\n\`\`\`ts\n${names.className}Module.forRootAsync({\n  imports: [ConfigModule],\n  inject: [ConfigService],\n  useFactory: (config: ConfigService) => ({ greeting: config.greeting }),\n});\n\`\`\`\n\nThe module is runtime-neutral: its source imports nothing from a platform, so\nthe same registration runs ${neutrality}.\n${contributionSection}\n## Scripts\n\n- \`bun run build\` builds the package with Vite+.\n- \`bun test\` runs the Bun tests.\n- \`bun run test:vite-plus\` runs the conformance lane.\n- \`bun run check\` formats, lints, and type-checks.\n\n## Library contract\n\n\`aponia.library.json\` states the package name, kind, entrypoint, provided tokens, framework compatibility, and security posture. Keep it in step with \`src/index.ts\`.\n\n## Documentation\n\n- [AponiaJS](https://github.com/aponiajs/aponiajs)\n`;
}

function packageAgents(names: ComponentNames, kind: PackageKind): string {
  const label = kind === "plugin" ? "plugin" : "package";
  const pluginInvariant =
    kind === "plugin"
      ? `- **The plugin contributes neutrally.** The module declares a controller, the \`${names.fileName}\` HTTP policy, and \`requirePlatformCapabilities("${names.fileName}", ["http"])\`. A native mount belongs in a separate adapter library, never here.\n- **One registration per application.** The registration key is the module identity; two registrations that share it fail with \`DUPLICATE_MODULE\`.\n`
      : "";
  return `# ${names.fileName} — Agent Guide\n\n\`CLAUDE.md\` and \`GEMINI.md\` are symlinks to this file.\n\nRead the [repository guide](../../AGENTS.md) first. This file covers only what is specific to this ${label}.\n\n## What this package owns\n\nThe ${names.className} module, its options, and its service. \`src/index.ts\`\nis the only public barrel.\n\n## Invariants\n\n- **The module is runtime-neutral.** Its source imports no platform package and\n  no HTTP runtime; a native mount belongs in a separate adapter library, and\n  nothing else may name a platform.\n${pluginInvariant}- **Nest's registration standard is the authoring surface.** The module exposes\n  \`forRoot(options)\` and \`forRootAsync({ imports, inject, useFactory })\`, both\n  returning a \`DynamicModule\`. Do not add a \`register\` alias.\n- **Options travel through a token.** \`${names.className}ModuleOptions\` is\n  provided under the exported \`*_OPTIONS\` token; the service injects it\n  optionally, so a plain import still boots.\n- **Tests boot the graph, not a platform.** \`compileRootModule\` plus\n  \`createContainer\` is the whole contract, which is what makes the test true on\n  every platform.\n- Export only through \`src/index.ts\`; never publish a deep source path.\n- Keep \`aponia.library.json\` in step with the exports and provided tokens.\n- Do not add a runtime dependency on \`@aponiajs/cli\`.\n\n## Tests\n\n\`tests/*.test.ts\` under Bun, \`tests-vp/*.conformance.ts\` under Vite+.\n`;
}

function packageLlms(names: ComponentNames, kind: PackageKind): string {
  const optionsToken = `${constantCase(names.className)}_OPTIONS`;
  const label = kind === "plugin" ? "plugin" : "library";
  const command = kind === "plugin" ? "aponia g plugin" : "aponia g library";
  const contributionLine =
    kind === "plugin"
      ? `\n- \`${names.className}Controller\`: the route the module contributes.\n- \`${names.fileName}\` HTTP policy: adds the registration's greeting to every response.\n- The module requires the \`http\` capability with \`requirePlatformCapabilities\`.\n`
      : "";
  return `# ${names.fileName}\n\n> An AponiaJS ${label} package generated by \`${command}\`, exporting ${names.className}Module and ${names.className}Service.\n\n## What this package exports\n\n- \`${names.className}Module\`: the module an application imports; \`forRoot\` and \`forRootAsync\` return the registration.\n- \`${names.className}Service\`: the injectable service.\n- \`${names.className}ModuleOptions\` / \`${names.className}ModuleAsyncOptions\`: the registration options.\n- \`${optionsToken}\`: the options token the module provides.\n${contributionLine}\n## Documentation\n\n- [Package README](README.md)\n- [AponiaJS](https://github.com/aponiajs/aponiajs)\n`;
}
