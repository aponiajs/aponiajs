import { join, relative, resolve } from "node:path";
import findFiles from "fast-glob";
import { analyzeControllerRoutes } from "./controller-routes.ts";
import { emitControllerInvokers } from "./controller-invokers.ts";
import { writePendingFiles } from "./file-writer.ts";
import {
  readConfiguration,
  resolveInside,
  resolveProject,
  toImportPath,
} from "./project-configuration.ts";
import type { AnalyzedController } from "./controller-routes.types.ts";
import type { GenerateInvokersOptions, GenerateInvokersResult } from "./invoker-generator.types.ts";
import type { PendingFile } from "./schematic.types.ts";

/**
 * The file a build writes, relative to the configured source root. It is a
 * fixed name so an application's entrypoint can import it without configuration.
 */
export const invokerModuleFileName = "invokers.generated.ts";

/**
 * Reads every controller under the configured source root and writes a module
 * whose route invokers are literal source.
 *
 * The runtime otherwise builds each invoker with `new Function` and infers a
 * handler's bindings from its own source. The written module replaces that for
 * every handler the analysis could prove, and a handler it declined stays on the
 * runtime's compile path — so a partially generated application is a supported
 * state and this never has to fail because one handler was unusual.
 *
 * Nothing here runs the application. The analysis reads source, which is why a
 * controller that only exists after some side effect is invisible to it.
 */
export async function generateInvokers(
  options: GenerateInvokersOptions,
): Promise<GenerateInvokersResult> {
  const projectRoot = resolve(options.cwd ?? process.cwd());
  const configuration = await readConfiguration(projectRoot);
  const project = resolveProject(configuration, options.project);
  const sourceRoot = resolveInside(
    projectRoot,
    project.sourceRoot ?? configuration.sourceRoot ?? "src",
  );
  const outputPath = join(sourceRoot, invokerModuleFileName);

  const sourceFiles = await findFiles("**/*.ts", {
    cwd: sourceRoot,
    absolute: true,
    ignore: ["**/*.spec.ts", "**/*.test.ts", `**/${invokerModuleFileName}`],
  });

  const found: { readonly controller: AnalyzedController; readonly file: string }[] = [];
  for (const file of sourceFiles.toSorted()) {
    const controllers = analyzeControllerRoutes(await Bun.file(file).text(), file);
    for (const controller of controllers) {
      found.push({ controller, file });
    }
  }

  if (found.length === 0) {
    throw new Error(
      `No class decorated with @Controller() was found under "${relative(projectRoot, sourceRoot)}".`,
    );
  }

  const imports: Record<string, string> = {};
  for (const { controller, file } of found) {
    if (imports[controller.className] !== undefined) {
      // The generated module imports each class by name, so two classes sharing
      // one name cannot both be addressed.
      throw new Error(
        `Two controllers are named "${controller.className}". Rename one; a generated ` +
          `invoker module imports each controller by its class name.`,
      );
    }
    imports[controller.className] = toImportPath(outputPath, file);
  }

  const emitted = emitControllerInvokers(
    found.map((entry) => entry.controller),
    imports,
  );
  if (emitted.source === undefined) {
    const [first] = emitted.declined;
    throw new Error(
      `No handler could be generated for. The first was "${first?.controller}.${first?.method}": ${first?.reason}.`,
    );
  }

  const files: PendingFile[] = [
    {
      path: outputPath,
      content: emitted.source,
      // Regenerating is the normal case, so the file is replaced rather than
      // refused when it is already there.
      kind: (await Bun.file(outputPath).exists()) ? "UPDATE" : "CREATE",
    },
  ];

  return writePendingFiles(projectRoot, files, options.dryRun);
}
