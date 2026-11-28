import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { loadCliConfiguration } from "./cli-configuration.ts";
import { scanSourceFiles } from "./file-scanner.ts";
import type {
  AponiaCliConfiguration,
  GenerateDefaults,
  ResolvedProject,
} from "../interfaces/cli-configuration.interface.ts";
import type { FindModuleFileOptions } from "../interfaces/schematic.interface.ts";
import type { GenerateSchematic } from "../interfaces/command.interface.ts";

/**
 * Reads the project configuration, refusing a directory that declares none.
 *
 * `info` and `start` read the defaults through `loadCliConfiguration`; the
 * generator and the build require a project, so a directory with neither
 * `aponia-cli.json` nor the legacy `aponia.json` is an error there.
 *
 * @param projectRoot - The directory the configuration is read from.
 * @returns The merged configuration.
 * @throws A plain `Error` when the directory declares no configuration.
 */
export async function readConfiguration(projectRoot: string): Promise<AponiaCliConfiguration> {
  const loaded = await loadCliConfiguration(projectRoot);
  if (loaded.source === "defaults") {
    throw new Error(
      'Could not find "aponia-cli.json" (or a legacy "aponia.json"). Run the command from an Aponia project root.',
    );
  }
  return loaded.configuration;
}
/**
 * Resolves one configured project, applying the workspace defaults.
 *
 * @param configuration - The merged `aponia-cli.json` configuration.
 * @param requestedProject - The project the caller named, if any.
 * @returns The project's root, source root, and generation defaults.
 * @throws A plain `Error` when the name is not a configured project.
 */
export function resolveProject(
  configuration: AponiaCliConfiguration,
  requestedProject: string | undefined,
): ResolvedProject {
  if (!requestedProject) {
    return {};
  }
  const project = configuration.projects?.[requestedProject];
  if (!project) {
    throw new Error(`Unknown project "${requestedProject}" in aponia-cli.json.`);
  }
  const fallbackSourceRoot =
    project.root === undefined ? (configuration.sourceRoot ?? "src") : join(project.root, "src");
  return {
    type: project.type,
    entryFile: project.entryFile ?? configuration.entryFile,
    exec: project.exec ?? configuration.exec,
    root: project.root,
    sourceRoot: project.sourceRoot ?? fallbackSourceRoot,
    tsConfigPath:
      project.compilerOptions?.tsConfigPath ?? configuration.compilerOptions?.tsConfigPath,
    generateOptions: project.generateOptions,
  };
}

/**
 * Reads the spec default for one schematic.
 *
 * @param value - The `generateOptions.spec` value.
 * @param schematic - The schematic being generated.
 * @returns The boolean default, or `undefined` when the configuration is silent.
 */
export function readSpecDefault(
  value: GenerateDefaults["spec"],
  schematic: GenerateSchematic,
): boolean | undefined {
  if (typeof value === "boolean" || value === undefined) {
    return value;
  }
  return value[schematic];
}

/**
 * Resolves a requested path inside a root, refusing one that escapes it.
 *
 * @param root - The root the path must stay inside.
 * @param path - The requested path.
 * @returns The absolute path.
 * @throws A plain `Error` when the path escapes the root.
 */
export function resolveInside(root: string, path: string): string {
  const resolved = resolve(root, path);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new Error(`Path "${path}" escapes the project root.`);
  }
  return resolved;
}

/**
 * Finds the module a generated declaration registers in.
 *
 * @param options - The source root, starting directory, and requested module.
 * @returns The module file, or `undefined` when none is reachable.
 */
export async function findModuleFile(options: FindModuleFileOptions): Promise<string | undefined> {
  if (options.requestedModule) {
    const candidates = await listModuleFiles(options.sourceRoot);
    const normalized = options.requestedModule.replace(/\.module(?:\.ts)?$/, "");
    const matches = candidates.filter((file) => {
      const relativeFile = relative(options.sourceRoot, file).replaceAll("\\", "/");
      return (
        relativeFile === `${normalized}.module.ts` ||
        relativeFile.endsWith(`/${normalized}.module.ts`)
      );
    });
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `Could not find module "${options.requestedModule}".`
          : `Module "${options.requestedModule}" is ambiguous.`,
      );
    }
    return matches[0];
  }

  let directory = options.fromDirectory;
  while (directory === options.sourceRoot || directory.startsWith(`${options.sourceRoot}${sep}`)) {
    const entries = await safeReadDirectory(directory);
    const modules = entries
      .filter((entry) => entry.endsWith(".module.ts"))
      .map((entry) => join(directory, entry))
      .filter((file) => file !== options.excludedFile)
      .toSorted();
    if (modules.length > 0) {
      return modules[0];
    }
    if (directory === options.sourceRoot) {
      break;
    }
    directory = dirname(directory);
  }
  return undefined;
}

/**
 * Builds the relative import path from a module to a generated file.
 *
 * @param moduleFile - The module the import is written into.
 * @param generatedFile - The file the module imports.
 * @returns A relative specifier starting with `./` or `../`.
 */
export function toImportPath(moduleFile: string, generatedFile: string): string {
  let path = relative(dirname(moduleFile), generatedFile).replaceAll("\\", "/");
  if (!path.startsWith(".")) {
    path = `./${path}`;
  }
  return path;
}

async function listModuleFiles(directory: string): Promise<string[]> {
  return scanSourceFiles("**/*.module.ts", directory);
}

async function safeReadDirectory(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}
