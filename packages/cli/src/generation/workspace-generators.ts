import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { aponiaVersion } from "../version.ts";
import type { ComponentNames } from "./component-names.types.ts";
import { renderSimpleSpec } from "./component-renderer.ts";
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
  const files: PendingFile[] = [
    createFile(
      directory,
      "package.json",
      `${JSON.stringify(
        {
          name: names.fileName,
          version: "0.0.0",
          private: true,
          type: "module",
          scripts: {
            build: "bun build ./src/index.ts --outdir ./dist --target bun",
            test: "bun test",
          },
          dependencies: {
            "@aponiajs/common": aponiaVersion,
          },
        },
        undefined,
        2,
      )}\n`,
    ),
    createFile(
      join(directory, "src"),
      `${names.fileName}.module.ts`,
      `import { Module } from "@aponiajs/common";\n\n@Module({})\nexport class ${names.className}Module {}\n`,
    ),
    createFile(
      join(directory, "src"),
      `${names.fileName}.service.ts`,
      `import { Injectable } from "@aponiajs/common";\n\n@Injectable()\nexport class ${names.className}Service {}\n`,
    ),
    createFile(
      join(directory, "src"),
      `${names.fileName}.service.spec.ts`,
      renderSimpleSpec(`./${names.fileName}.service.ts`, `${names.className}Service`),
    ),
    createFile(
      join(directory, "src"),
      "index.ts",
      `export { ${names.className}Module } from "./${names.fileName}.module.ts";\nexport { ${names.className}Service } from "./${names.fileName}.service.ts";\n`,
    ),
  ];

  return writePendingFiles(projectRoot, files, options.dryRun);
}
