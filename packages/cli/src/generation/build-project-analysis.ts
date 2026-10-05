import { join, resolve } from "node:path";
import { analyzeControllerRoutes } from "./controller-routes.ts";
import { emitControllerInvokers } from "./controller-invokers.ts";
import { descriptorModuleFileName, emitModuleDescriptors } from "./descriptor-emitter.ts";
import { analyzeModuleDescriptors } from "./module-descriptors.ts";
import {
  readConfiguration,
  resolveInside,
  resolveProject,
  toImportPath,
} from "./project-configuration.ts";
import { collectSourceImports } from "./source-imports.ts";
import { scanSourceFiles } from "./file-scanner.ts";
import type { AnalyzedController } from "./controller-routes.types.ts";
import type { DescriptorSourceFile } from "./descriptor-emitter.types.ts";
import type {
  AnalyzeBuildProjectOptions,
  BuildProjectAnalysis,
} from "./build-project-analysis.types.ts";
import { aponiaVersion } from "../version.ts";

/** Fixed invoker artifact filename, relative to the configured source root. */
export const invokerModuleFileName = "invokers.generated.ts";

/**
 * Reads project configuration and sorted source files, then asks both build
 * emitters for their decisions without executing application code or writing files.
 * Empty controller sets and fully declined emission are successful analysis;
 * configuration, source-reading, and ambiguous controller failures reject.
 *
 * @param options - Working directory and optional named project, as for `aponia build`.
 * @returns Frozen controllers, artifact paths, provenance, and unformatted emission results.
 * @example
 * ```ts
 * const analysis = await analyzeBuildProject({ cwd: projectRoot });
 * console.log(analysis.invokers.declined);
 * ```
 */
export async function analyzeBuildProject(
  options: AnalyzeBuildProjectOptions = {},
): Promise<BuildProjectAnalysis> {
  const projectRoot = resolve(options.cwd ?? process.cwd());
  const configuration = await readConfiguration(projectRoot);
  const project = resolveProject(configuration, options.project);
  const sourceRoot = resolveInside(
    projectRoot,
    project.sourceRoot ?? configuration.sourceRoot ?? "src",
  );
  const invokerPath = join(sourceRoot, invokerModuleFileName);
  const descriptorPath = join(sourceRoot, descriptorModuleFileName);
  const sourceFiles = await scanSourceFiles("**/*.ts", sourceRoot, [
    "**/*.spec.ts",
    "**/*.test.ts",
    `**/${invokerModuleFileName}`,
    `**/${descriptorModuleFileName}`,
  ]);
  const controllers: AnalyzedController[] = [];
  const analyzed: DescriptorSourceFile[] = [];
  const imports: Record<string, string> = {};
  for (const file of sourceFiles.toSorted()) {
    const source = await Bun.file(file).text();
    const found = analyzeControllerRoutes(source, file);
    for (const controller of found) {
      if (Object.hasOwn(imports, controller.className)) {
        throw new Error(
          `Two controllers are named "${controller.className}". Rename one; a generated ` +
            `invoker module imports each controller by its class name.`,
        );
      }
      imports[controller.className] = toImportPath(invokerPath, file);
      controllers.push(controller);
    }
    analyzed.push({
      file,
      imports: collectSourceImports(source, file),
      descriptors: analyzeModuleDescriptors(source, file),
      controllers: found,
    });
  }
  const provenance = Object.freeze({
    framework: aponiaVersion,
    elysia: await resolvePeerVersion(projectRoot),
  });
  return Object.freeze({
    projectRoot,
    sourceRoot,
    invokerPath,
    descriptorPath,
    controllers: Object.freeze(controllers),
    provenance,
    invokers: emitControllerInvokers(controllers, imports, provenance),
    descriptors: emitModuleDescriptors(analyzed, descriptorPath, provenance),
  });
}

async function resolvePeerVersion(projectRoot: string): Promise<string | null> {
  try {
    const manifestPath = Bun.resolveSync("elysia/package.json", projectRoot);
    const manifest = (await Bun.file(manifestPath).json()) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}
