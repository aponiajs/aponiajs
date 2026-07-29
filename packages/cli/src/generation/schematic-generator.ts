import { dirname, resolve } from "node:path";
import { createComponentNames } from "./component-names.ts";
import { createComponentFiles, createResourceFiles } from "./file-planner.ts";
import { writePendingFiles } from "./file-writer.ts";
import { registerInModule } from "./module-registration.ts";
import {
  findModuleFile,
  readConfiguration,
  readSpecDefault,
  resolveInside,
  resolveProject,
  toImportPath,
} from "./project-configuration.ts";
import { primaryFile, registrationFor, symbolFor } from "./schematic-definitions.ts";
import type { GenerateSchematicOptions, GenerateSchematicResult } from "./schematic.types.ts";
import { generateApplication, generateLibrary } from "./workspace-generators.ts";

export async function generateSchematic(
  options: GenerateSchematicOptions,
): Promise<GenerateSchematicResult> {
  const projectRoot = resolve(options.cwd ?? process.cwd());
  const names = createComponentNames(options.name);

  if (options.schematic === "app") {
    return generateApplication(projectRoot, names.fileName, options);
  }
  if (options.schematic === "library") {
    return generateLibrary(projectRoot, names, options);
  }

  const configuration = await readConfiguration(projectRoot);
  const project = resolveProject(configuration, options.project);
  const sourceRoot = resolveInside(
    projectRoot,
    project.sourceRoot ?? configuration.sourceRoot ?? "src",
  );
  const basePath = options.path ? resolveInside(projectRoot, options.path) : sourceRoot;
  const spec =
    options.spec ??
    readSpecDefault(project.generateOptions?.spec, options.schematic) ??
    readSpecDefault(configuration.generateOptions?.spec, options.schematic) ??
    true;
  const effectiveOptions: GenerateSchematicOptions = {
    ...options,
    flat: options.flat ?? project.generateOptions?.flat ?? configuration.generateOptions?.flat,
  };

  const files =
    options.schematic === "resource"
      ? createResourceFiles(basePath, names, effectiveOptions, spec)
      : createComponentFiles(basePath, names, effectiveOptions, spec);

  const registration = registrationFor(options.schematic);
  if (registration && !options.skipImport) {
    const primary = primaryFile(files, options.schematic);
    const moduleFile = await findModuleFile({
      sourceRoot,
      fromDirectory: dirname(primary.path),
      requestedModule: options.module,
      excludedFile: options.schematic === "module" ? primary.path : undefined,
    });
    if (moduleFile) {
      const original = await Bun.file(moduleFile).text();
      const symbol = symbolFor(options.schematic, names);
      const importPath = toImportPath(moduleFile, primary.path);
      const updated = registerInModule(original, registration, symbol, importPath);
      if (updated !== original) {
        files.push({ path: moduleFile, content: updated, kind: "UPDATE" });
      }
    }
  }

  return writePendingFiles(projectRoot, files, options.dryRun);
}
