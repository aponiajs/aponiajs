import { dirname, join, relative, resolve } from "node:path";
import type { SchematicOptions } from "@aponiajs/schematics";
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
import type {
  GenerateSchematicOptions,
  GenerateSchematicResult,
  PendingFile,
} from "../interfaces/schematic.interface.ts";
import type { GenerateSchematic } from "../interfaces/command.interface.ts";
import { generateApplication, generateLibrary, generatePlugin } from "./workspace-generators.ts";
import { generateMcpFeature } from "./mcp-generator.ts";
import { generateProject } from "./project-generator.ts";
import { upgradeAponiaPackages } from "./upgrade-generator.ts";
import {
  applySchematicSchema,
  findSchematic,
  readSchematicSchema,
  resolveCollection,
  runSchematic,
} from "./schematic-collection.ts";

/**
 * Plans, renders, registers, and writes one schematic: a component, a
 * resource, an application, a library, a configuration, or an upgrade.
 *
 * Configuration lookup, file planning, rendering, module registration, and
 * filesystem writes stay in focused collaborators; this function only
 * orchestrates them.
 *
 * @param options - The schematic, name, transport, flags, and project root.
 * @returns The `CREATE`/`UPDATE` change lines `runCli` prints.
 *
 * @example
 * ```ts
 * await generateSchematic({ schematic: "resource", name: "users", type: "rest" });
 * ```
 */
export async function generateSchematic(
  options: GenerateSchematicOptions,
): Promise<GenerateSchematicResult> {
  const projectRoot = resolve(options.cwd ?? process.cwd());

  if (options.schematic === "upgrade") {
    return upgradeAponiaPackages(projectRoot, options);
  }

  if (options.language === "js" && options.collection === undefined) {
    throw new Error(
      'The Aponia generator emits TypeScript only; "--language js" is not supported.',
    );
  }

  let schematicOptions = options;
  let componentName = options.name;
  if (options.schematic === "configuration") {
    return generateConfiguration(projectRoot, schematicOptions);
  }
  if (!componentName) {
    throw new Error("Schematic name is required.");
  }
  if (
    (options.schematic === "library" || options.schematic === "plugin") &&
    componentName.includes("/")
  ) {
    const [scopePart, packagePart] = componentName.split("/", 2);
    if (!scopePart || !packagePart) {
      throw new Error("A scoped package name must use the @scope/package shape.");
    }
    schematicOptions = { ...options, scope: scopePart.replace(/^@/, "") };
    componentName = packagePart;
  }
  const names = createComponentNames(componentName);

  if (options.collection !== undefined) {
    const configuration = await readConfiguration(projectRoot);
    const project = resolveProject(configuration, options.project);
    const sourceRoot = project.sourceRoot ?? configuration.sourceRoot ?? "src";
    const spec =
      options.spec ??
      readSpecDefault(project.generateOptions?.spec, options.schematic) ??
      readSpecDefault(configuration.generateOptions?.spec, options.schematic) ??
      true;
    const specFileSuffix =
      options.specFileSuffix ??
      project.generateOptions?.specFileSuffix ??
      configuration.generateOptions?.specFileSuffix ??
      "spec";
    const flat =
      options.flat ?? project.generateOptions?.flat ?? configuration.generateOptions?.flat;
    const baseDir =
      project.generateOptions?.baseDir ?? configuration.generateOptions?.baseDir ?? sourceRoot;
    return generateFromCollection(
      projectRoot,
      {
        ...schematicOptions,
        path: options.path ?? collectionDefaultPath(options.schematic, baseDir, names.fileName),
        spec,
        specFileSuffix,
        flat,
      },
      sourceRoot,
      options.collection,
    );
  }

  if (options.schematic === "application") {
    return generateFullApplication(projectRoot, names.fileName, schematicOptions);
  }
  if (options.schematic === "app") {
    return generateApplication(projectRoot, names.fileName, schematicOptions);
  }
  if (options.schematic === "library") {
    return generateLibrary(projectRoot, names, schematicOptions);
  }
  if (options.schematic === "plugin") {
    return generatePlugin(projectRoot, names, schematicOptions);
  }
  if (options.schematic === "mcp") {
    return generateMcpFeature(projectRoot, componentName, schematicOptions);
  }

  const configuration = await readConfiguration(projectRoot);

  const project = resolveProject(configuration, options.project);
  const sourceRoot = resolveInside(
    projectRoot,
    project.sourceRoot ?? configuration.sourceRoot ?? "src",
  );
  const baseDir = project.generateOptions?.baseDir ?? configuration.generateOptions?.baseDir;
  const basePath = options.path
    ? resolveInside(projectRoot, options.path)
    : baseDir
      ? resolveInside(projectRoot, baseDir)
      : sourceRoot;
  const spec =
    options.spec ??
    readSpecDefault(project.generateOptions?.spec, options.schematic) ??
    readSpecDefault(configuration.generateOptions?.spec, options.schematic) ??
    true;
  const specFileSuffix =
    options.specFileSuffix ??
    project.generateOptions?.specFileSuffix ??
    configuration.generateOptions?.specFileSuffix ??
    "spec";
  const effectiveOptions: GenerateSchematicOptions = {
    ...options,
    flat: options.flat ?? project.generateOptions?.flat ?? configuration.generateOptions?.flat,
    specFileSuffix,
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
    if (!moduleFile) {
      // Registration was asked for, so skipping it silently would report success
      // for a run that only wrote half the files. Fail before anything is written.
      throw new Error(
        `Could not find a module to register "${relative(projectRoot, primary.path)}" ` +
          `inside "${relative(projectRoot, sourceRoot)}". Generate there, or pass ` +
          '"--skip-import" to create the files without registering them.',
      );
    }
    const original = await Bun.file(moduleFile).text();
    const symbol = symbolFor(options.schematic, names);
    const importPath = toImportPath(moduleFile, primary.path);
    const updated = registerInModule(original, registration, symbol, importPath);
    if (updated !== original) {
      files.push({ path: moduleFile, content: updated, kind: "UPDATE", type: "content" });
    }
  }

  return writePendingFiles(projectRoot, files, options.dryRun);
}

async function generateFullApplication(
  projectRoot: string,
  name: string,
  options: GenerateSchematicOptions,
): Promise<GenerateSchematicResult> {
  const type = options.applicationType ?? "bun";
  const testRunner =
    options.applicationType === "esm"
      ? "vitest"
      : options.applicationType === "cjs"
        ? "jest"
        : "bun";
  const result = await generateProject({
    name,
    cwd: projectRoot,
    dryRun: options.dryRun,
    skipInstall: options.skipInstall,
    skipGit: true,
    skipSkills: true,
    type,
    testRunner,
    minimal: false,
    strict: options.strict ?? true,
    collection: options.collection,
    language: options.language,
  });
  return {
    dryRun: result.dryRun,
    changes: result.files.map((file) => ({ kind: "CREATE", path: join(name, file) })),
  };
}

async function generateConfiguration(
  projectRoot: string,
  options: GenerateSchematicOptions,
): Promise<GenerateSchematicResult> {
  const path = resolveInside(projectRoot, options.path ?? "");
  const configuration = {
    collection: options.collection ?? "@aponiajs/schematics",
    sourceRoot: "src",
    entryFile: "main",
    language: "ts",
    generateOptions: { spec: true },
    compilerOptions: { deleteOutDir: true },
  };
  const target = resolve(path, "aponia-cli.json");
  return writePendingFiles(
    projectRoot,
    [
      {
        path: target,
        content: `${JSON.stringify(configuration, undefined, 2)}\n`,
        kind: "CREATE",
        type: "content",
      },
    ],
    options.dryRun,
  );
}

async function generateFromCollection(
  projectRoot: string,
  options: GenerateSchematicOptions,
  sourceRoot: string | undefined,
  collectionName: string,
): Promise<GenerateSchematicResult> {
  const resolved = await resolveCollection(projectRoot, collectionName);
  const schematic = findSchematic(resolved, options.schematic);
  const schema = await readSchematicSchema(resolved, schematic.entry);
  const isEsm = await isEsmProject(projectRoot);
  const raw: Readonly<Record<string, unknown>> = {
    name: options.name,
    path: options.path,
    language: options.language ?? "ts",
    flat: options.flat,
    spec: options.spec,
    specFileSuffix: options.specFileSuffix,
    skipImport: options.skipImport,
    module: options.module,
    sourceRoot,
    strict: options.strict,
    collection: collectionName,
    isEsm,
    ...(options.schematic === "application"
      ? { type: options.applicationType ?? (isEsm ? "esm" : "cjs") }
      : options.schematic === "resource"
        ? { type: options.type, crud: options.crud }
        : {}),
  };
  const validated = schema === undefined ? raw : applySchematicSchema(schema, raw);
  const plan = await runSchematic(resolved, schematic, {
    ...validated,
    name: options.name,
  } as SchematicOptions);

  const files: PendingFile[] = plan.files.map((file) => ({
    path: resolveInside(projectRoot, file.path),
    content: file.content,
    kind: "CREATE",
    type: "content",
  }));
  return writePendingFiles(projectRoot, files, options.dryRun);
}

/**
 * Whether a project compiles as ESM.
 *
 * The upstream component templates append `.js` only in an ESM project. The
 * CLI's own configuration records no module system, so the project's manifest
 * and tsconfig are the two facts Nest reads as well.
 */
async function isEsmProject(projectRoot: string): Promise<boolean> {
  const manifest = Bun.file(join(projectRoot, "package.json"));
  if (await manifest.exists()) {
    try {
      const parsed = (await manifest.json()) as { readonly type?: unknown };
      if (parsed.type === "module") {
        return true;
      }
    } catch {
      // A malformed manifest is the project's error, not this detection's.
    }
  }

  const tsconfig = Bun.file(join(projectRoot, "tsconfig.json"));
  if (!(await tsconfig.exists())) {
    return false;
  }
  try {
    const parsed = (await tsconfig.json()) as {
      readonly compilerOptions?: { readonly module?: unknown };
    };
    const module = parsed.compilerOptions?.module;
    return (
      typeof module === "string" &&
      ["esnext", "es2022", "es2020", "es6", "nodenext"].includes(module.toLowerCase())
    );
  } catch {
    return false;
  }
}

/**
 * The directory a collection schematic writes into.
 *
 * `nest-cli.json` resolves a component against the source root, while the
 * workspace schematics own their top-level folders: `apps/` for a sub-app,
 * `libs/` for a library, and the named directory for an application. A
 * component keeps the configured `baseDir`.
 */
function collectionDefaultPath(
  schematic: GenerateSchematic,
  fallback: string,
  name: string,
): string {
  switch (schematic) {
    case "application":
      return name;
    case "app":
      return "apps";
    case "library":
      return "libs";
    default:
      return fallback;
  }
}
