import { relative } from "node:path";
import { analyzeBuildProject, invokerModuleFileName } from "./build-project-analysis.ts";
import {
  descriptorModuleFileName,
  emitEmptyModuleDescriptorArtifact,
} from "./descriptor-emitter.ts";
import { writePendingFiles } from "./file-writer.ts";
import { formatGeneratedSource } from "./generated-source-formatter.ts";
import type { GenerateInvokersOptions, GenerateInvokersResult } from "./invoker-generator.types.ts";
import type { PendingFile } from "./schematic.types.ts";

export { invokerModuleFileName } from "./build-project-analysis.ts";

/**
 * Analyzes source without running the application, formats both artifacts, and
 * writes them beside the configured source root. Declined handlers retain the
 * platform's compile path; declined modules retain decorated lowering.
 * An existing descriptor is replaced with an empty record when none can be
 * emitted, so a graph the source no longer declares is not left on disk.
 *
 * @param options - Working directory, named project, and dry-run flag.
 * @returns Written files and descriptor declines.
 * @example
 * ```ts
 * await generateInvokers({ cwd: projectRoot, dryRun: false });
 * ```
 */
export async function generateInvokers(
  options: GenerateInvokersOptions,
): Promise<GenerateInvokersResult> {
  const analysis = await analyzeBuildProject(options);
  const {
    projectRoot,
    sourceRoot,
    provenance,
    invokers: emitted,
    descriptors,
    invokerPath: outputPath,
    descriptorPath,
  } = analysis;
  if (analysis.controllers.length === 0) {
    throw new Error(
      `No class decorated with @Controller() was found under "${relative(projectRoot, sourceRoot)}".`,
    );
  }
  if (emitted.source === undefined) {
    const [first] = emitted.declined;
    throw new Error(
      `No handler could be generated for. The first was "${first?.controller}.${first?.method}": ${first?.reason}.`,
    );
  }
  const pending: PendingFile[] = [
    {
      path: outputPath,
      content: await formatGeneratedSource(projectRoot, invokerModuleFileName, emitted.source),
      kind: (await Bun.file(outputPath).exists()) ? "UPDATE" : "CREATE",
    },
  ];
  const descriptorExists = await Bun.file(descriptorPath).exists();
  const descriptorSource =
    descriptors.source ??
    (descriptorExists ? emitEmptyModuleDescriptorArtifact(provenance) : undefined);
  if (descriptorSource !== undefined) {
    pending.push({
      path: descriptorPath,
      content: await formatGeneratedSource(projectRoot, descriptorModuleFileName, descriptorSource),
      kind: descriptorExists ? "UPDATE" : "CREATE",
    });
  }
  const result = await writePendingFiles(projectRoot, pending, options.dryRun);
  return { ...result, declined: descriptors.declined };
}
