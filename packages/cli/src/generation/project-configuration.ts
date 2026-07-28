import findFiles from "fast-glob";
import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { GenerateSchematic } from "../commands/command.types.ts";
import type {
  AponiaConfiguration,
  FindModuleFileOptions,
  GenerateDefaults,
  ResolvedProject,
} from "./schematic.types.ts";

export async function readConfiguration(projectRoot: string): Promise<AponiaConfiguration> {
  const file = Bun.file(join(projectRoot, "aponia.json"));
  if (!(await file.exists())) {
    throw new Error('Could not find "aponia.json". Run the command from an Aponia project root.');
  }
  return (await file.json()) as AponiaConfiguration;
}

export function resolveProject(
  configuration: AponiaConfiguration,
  requestedProject: string | undefined,
): ResolvedProject {
  if (!requestedProject) {
    return {};
  }
  const project = configuration.projects?.[requestedProject];
  if (!project) {
    throw new Error(`Unknown project "${requestedProject}" in aponia.json.`);
  }
  return {
    root: project.root,
    sourceRoot: project.sourceRoot ?? join(project.root ?? "", "src"),
    generateOptions: project.generateOptions,
  };
}

export function readSpecDefault(
  value: GenerateDefaults["spec"],
  schematic: GenerateSchematic,
): boolean | undefined {
  if (typeof value === "boolean" || value === undefined) {
    return value;
  }
  return value[schematic];
}

export function resolveInside(root: string, path: string): string {
  const resolved = resolve(root, path);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new Error(`Path "${path}" escapes the project root.`);
  }
  return resolved;
}

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

export function toImportPath(moduleFile: string, generatedFile: string): string {
  let path = relative(dirname(moduleFile), generatedFile).replaceAll("\\", "/");
  if (!path.startsWith(".")) {
    path = `./${path}`;
  }
  return path;
}

async function listModuleFiles(directory: string): Promise<string[]> {
  return findFiles("**/*.module.ts", {
    absolute: true,
    cwd: directory,
    onlyFiles: true,
  });
}

async function safeReadDirectory(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}
