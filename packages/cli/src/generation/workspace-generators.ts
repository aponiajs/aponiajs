import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { aponiaVersion } from "../version.ts";
import type { ComponentNames } from "./component-names.types.ts";
import { createFile, writePendingFiles } from "./file-writer.ts";
import { generateProject } from "./project-generator.ts";
import type {
  GenerateSchematicOptions,
  GenerateSchematicResult,
  PendingFile,
} from "./schematic.types.ts";

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
  });

  return {
    dryRun: options.dryRun,
    changes: result.files.map((file) => ({
      kind: "CREATE",
      path: join("apps", name, file),
    })),
  };
}

export async function generateLibrary(
  projectRoot: string,
  names: ComponentNames,
  options: GenerateSchematicOptions,
): Promise<GenerateSchematicResult> {
  const standalone = options.standalone === true;
  const directory = standalone
    ? join(projectRoot, names.fileName)
    : join(projectRoot, "libs", names.fileName);
  const publish = options.publish === true;
  const scope = options.scope?.trim().replace(/^@/, "");
  const packageName = scope ? `@${scope}/${names.fileName}` : names.fileName;
  const manifest = {
    contractVersion: 1,
    name: packageName,
    kind: "module",
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
    ],
    requires: [],
    security: { network: false, filesystem: false, postinstall: false, permissions: [] },
  } as const;
  const files: PendingFile[] = [
    createFile(
      directory,
      "package.json",
      `${JSON.stringify(
        {
          name: packageName,
          version: publish ? "0.1.0" : "0.0.0",
          description: `${names.className} library for AponiaJS.`,
          license: "MIT",
          keywords: ["aponia", "aponiajs", "aponia-library"],
          packageManager: "bun@1.4.4",
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
          ...(publish ? {} : { dependencies: { "@aponiajs/common": aponiaVersion } }),
          ...(publish ? { peerDependencies: { "@aponiajs/common": `^${aponiaVersion}` } } : {}),
          devDependencies: {
            "@aponiajs/common": aponiaVersion,
            "@aponiajs/platform-elysia": aponiaVersion,
            elysia: "2.0.0-rc.4",
            typescript: "^7.0.2",
            "vite-plus": "^1.5.0",
          },
        },
        undefined,
        2,
      )}\n`,
    ),
    createFile(directory, "tsconfig.json", libraryTsconfig()),
    createFile(directory, "tsconfig.build.json", libraryBuildTsconfig()),
    createFile(directory, "vite.config.ts", libraryViteConfig()),
    createFile(directory, "README.md", libraryReadme(names, publish, packageName)),
    createFile(directory, "AGENTS.md", libraryAgents(names)),
    createFile(directory, "llms.txt", libraryLlms(names)),
    createFile(directory, "aponia.library.json", `${JSON.stringify(manifest, undefined, 2)}\n`),
    createFile(
      join(directory, "src"),
      `${names.fileName}.module.ts`,
      `import { Module } from "@aponiajs/common";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\n\n@Module({ providers: [${names.className}Service], exports: [${names.className}Service] })\nexport class ${names.className}Module {}\n`,
    ),
    createFile(
      join(directory, "src"),
      `${names.fileName}.service.ts`,
      `import { Injectable } from "@aponiajs/common";\n\n@Injectable()\nexport class ${names.className}Service {\n  greet(): string {\n    return "Hello from ${names.className}";\n  }\n}\n`,
    ),
    createFile(
      join(directory, "tests"),
      `${names.fileName}.test.ts`,
      `import { describe, expect, test } from "bun:test";\nimport { defineModule } from "@aponiajs/common";\nimport { AponiaFactory } from "@aponiajs/platform-elysia";\nimport { ${names.className}Module, ${names.className}Service } from "../src/index.ts";\n\ndescribe("${names.className}Service", () => {\n  test("resolves through the Aponia container", async () => {\n    const AppModule = defineModule({ id: "${names.className}TestModule", imports: [${names.className}Module] });\n    const application = await AponiaFactory.create(AppModule, { logger: false });\n    try {\n      expect(application.get(${names.className}Service).greet()).toBe("Hello from ${names.className}");\n    } finally {\n      await application.close();\n    }\n  });\n});\n`,
    ),
    createFile(
      join(directory, "tests-vp"),
      `${names.fileName}.conformance.ts`,
      `import { defineModule } from "@aponiajs/common";\nimport { AponiaFactory } from "@aponiajs/platform-elysia";\nimport { ${names.className}Module, ${names.className}Service } from "../src/index.ts";\n\ntype VitePlusTest = typeof import("vite-plus/test");\n\ndeclare const test: VitePlusTest["test"];\ndeclare const expect: VitePlusTest["expect"];\n\ntest("resolves the service through an application", async () => {\n  const AppModule = defineModule({ id: "${names.className}ConformanceModule", imports: [${names.className}Module] });\n  const application = await AponiaFactory.create(AppModule, { logger: false });\n  try {\n    expect(application.get(${names.className}Service).greet()).toBe("Hello from ${names.className}");\n  } finally {\n    await application.close();\n  }\n});\n`,
    ),
    createFile(
      join(directory, "src"),
      "index.ts",
      `export { ${names.className}Module } from "./${names.fileName}.module.ts";\nexport { ${names.className}Service } from "./${names.fileName}.service.ts";\n`,
    ),
  ];

  const result = await writePendingFiles(projectRoot, files, options.dryRun);
  if (!options.dryRun && !standalone) {
    await wireWorkspaceLibrary(projectRoot, packageName, options);
  }
  if (!options.dryRun && standalone && options.skipInstall !== true) {
    const install = Bun.spawn(["bun", "install"], {
      cwd: directory,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await install.exited) !== 0) {
      throw new Error("bun install failed after generating the standalone library.");
    }
  }
  return result;
}

async function wireWorkspaceLibrary(
  projectRoot: string,
  packageName: string,
  options: GenerateSchematicOptions,
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
  await Bun.write(
    targetPath,
    `${JSON.stringify(
      { ...target, dependencies: { ...target.dependencies, [packageName]: "workspace:*" } },
      undefined,
      2,
    )}\n`,
  );

  if (options.skipInstall !== true) {
    const install = Bun.spawn(["bun", "install"], {
      cwd: projectRoot,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await install.exited) !== 0) {
      throw new Error("bun install failed after generating the workspace library.");
    }
  }
}

function libraryTsconfig(): string {
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

function libraryBuildTsconfig(): string {
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

function libraryViteConfig(): string {
  return `import { defineConfig } from "vite-plus";\n\nexport default defineConfig({\n  test: {\n    globals: true,\n    include: ["tests-vp/**/*.conformance.ts"],\n  },\n  pack: {\n    tsconfig: "tsconfig.build.json",\n    dts: true,\n    exports: true,\n    deps: {\n      neverBundle: ["@aponiajs/common", "@aponiajs/platform-elysia", "elysia"],\n    },\n  },\n  lint: {\n    options: {\n      typeAware: true,\n      typeCheck: true,\n    },\n  },\n  fmt: {},\n});\n`;
}

function libraryReadme(names: ComponentNames, publish: boolean, packageName: string): string {
  return `# ${packageName}\n\n${publish ? "A publishable" : "A private workspace"} AponiaJS library generated by \`aponia g library\`.\n\n\`\`\`ts\nimport { ${names.className}Module } from "${packageName}";\n\`\`\`\n\n## Scripts\n\n- \`bun run build\` builds the package with Vite+.\n- \`bun test\` runs the Bun tests.\n- \`bun run test:vite-plus\` runs the conformance lane.\n- \`bun run check\` formats, lints, and type-checks.\n\n## Library contract\n\n\`aponia.library.json\` states the package name, kind, entrypoint, provided tokens, framework compatibility, and security posture. Keep it in step with \`src/index.ts\`.\n\n## Documentation\n\n- [AponiaJS](https://github.com/aponiajs/aponiajs)\n`;
}

function libraryAgents(names: ComponentNames): string {
  return `# ${names.fileName} — Agent Guide\n\nRead the [repository guide](../../AGENTS.md) first. This file covers only what is specific to this package.\n\n## What this package owns\n\nThe ${names.className} module and service. \`src/index.ts\` is the only public barrel.\n\n## Invariants\n\n- Export only through \`src/index.ts\`; never publish a deep source path.\n- Keep \`aponia.library.json\` in step with the exports and provided tokens.\n- Keep the Bun and Vite+ test lanes green.\n- Do not add a runtime dependency on \`@aponiajs/cli\`.\n\n## Tests\n\n\`tests/*.test.ts\` under Bun, \`tests-vp/*.conformance.ts\` under Vite+.\n`;
}

function libraryLlms(names: ComponentNames): string {
  return `# ${names.fileName}\n\n> An AponiaJS library package generated by \`aponia g library\`, exporting ${names.className}Module and ${names.className}Service.\n\n## What this package exports\n\n- \`${names.className}Module\`: the module an application imports.\n- \`${names.className}Service\`: the injectable service.\n\n## Documentation\n\n- [Package README](README.md)\n- [AponiaJS](https://github.com/aponiajs/aponiajs)\n`;
}
