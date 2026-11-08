import { mkdir } from "node:fs/promises";
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
  const directory = join(projectRoot, "packages", names.fileName);
  const publish = options.publish === true;
  const manifest = {
    contractVersion: 1,
    name: names.fileName,
    kind: "module",
    framework: { aponia: aponiaVersion, bun: ">=1.4.2" },
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
          name: names.fileName,
          version: "0.0.0",
          description: `${names.className} library for AponiaJS.`,
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
          dependencies: {
            "@aponiajs/common": aponiaVersion,
          },
          devDependencies: {
            "@aponiajs/platform-elysia": aponiaVersion,
            elysia: "2.0.0-beta.24",
            typescript: "^7.0.2",
            "vite-plus": "^0.2.9",
          },
        },
        undefined,
        2,
      )}\n`,
    ),
    createFile(directory, "tsconfig.json", libraryTsconfig()),
    createFile(directory, "tsconfig.build.json", libraryBuildTsconfig()),
    createFile(directory, "vite.config.ts", libraryViteConfig()),
    createFile(directory, "README.md", libraryReadme(names, publish)),
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
      `import { describe, expect, test } from "bun:test";\nimport { ${names.className}Service } from "../src/index.ts";\n\ndescribe("${names.className}Service", () => {\n  test("greets", () => {\n    expect(new ${names.className}Service().greet()).toBe("Hello from ${names.className}");\n  });\n});\n`,
    ),
    createFile(
      join(directory, "tests-vp"),
      `${names.fileName}.conformance.ts`,
      `import { ${names.className}Service } from "../src/index.ts";\n\ntype VitePlusTest = typeof import("vite-plus/test");\n\ndeclare const test: VitePlusTest["test"];\ndeclare const expect: VitePlusTest["expect"];\n\ntest("exports the service", () => {\n  expect(new ${names.className}Service().greet()).toBe("Hello from ${names.className}");\n});\n`,
    ),
    createFile(
      join(directory, "src"),
      "index.ts",
      `export { ${names.className}Module } from "./${names.fileName}.module.ts";\nexport { ${names.className}Service } from "./${names.fileName}.service.ts";\n`,
    ),
  ];

  return writePendingFiles(projectRoot, files, options.dryRun);
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
  return `import { defineConfig } from "vite-plus";\n\nexport default defineConfig({\n  test: {\n    globals: true,\n    include: ["tests-vp/**/*.conformance.ts"],\n  },\n  pack: {\n    tsconfig: "tsconfig.build.json",\n    dts: {\n      tsgo: true,\n      tsconfig: "tsconfig.build.json",\n    },\n    exports: true,\n    deps: {\n      neverBundle: ["@aponiajs/common", "@aponiajs/platform-elysia", "elysia"],\n    },\n  },\n  lint: {\n    options: {\n      typeAware: true,\n      typeCheck: true,\n    },\n  },\n  fmt: {},\n});\n`;
}

function libraryReadme(names: ComponentNames, publish: boolean): string {
  return `# ${names.fileName}\n\n${publish ? "A publishable" : "A private workspace"} AponiaJS library generated by \`aponia g library\`.\n\n\`\`\`ts\nimport { ${names.className}Module } from "${names.fileName}";\n\`\`\`\n\n## Scripts\n\n- \`bun run build\` builds the package with Vite+.\n- \`bun test\` runs the Bun tests.\n- \`bun run test:vite-plus\` runs the conformance lane.\n- \`bun run check\` formats, lints, and type-checks.\n\n## Library contract\n\n\`aponia.library.json\` states the package name, kind, entrypoint, provided tokens, framework compatibility, and security posture. Keep it in step with \`src/index.ts\`.\n\n## Documentation\n\n- [AponiaJS](https://github.com/aponiajs/aponiajs)\n`;
}

function libraryAgents(names: ComponentNames): string {
  return `# ${names.fileName} — Agent Guide\n\nRead the [repository guide](../../AGENTS.md) first. This file covers only what is specific to this package.\n\n## What this package owns\n\nThe ${names.className} module and service. \`src/index.ts\` is the only public barrel.\n\n## Invariants\n\n- Export only through \`src/index.ts\`; never publish a deep source path.\n- Keep \`aponia.library.json\` in step with the exports and provided tokens.\n- Keep the Bun and Vite+ test lanes green.\n- Do not add a runtime dependency on \`@aponiajs/cli\`.\n\n## Tests\n\n\`tests/*.test.ts\` under Bun, \`tests-vp/*.conformance.ts\` under Vite+.\n`;
}

function libraryLlms(names: ComponentNames): string {
  return `# ${names.fileName}\n\n> An AponiaJS library package generated by \`aponia g library\`, exporting ${names.className}Module and ${names.className}Service.\n\n## What this package exports\n\n- \`${names.className}Module\`: the module an application imports.\n- \`${names.className}Service\`: the injectable service.\n\n## Documentation\n\n- [Package README](README.md)\n- [AponiaJS](https://github.com/aponiajs/aponiajs)\n`;
}
