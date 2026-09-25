import { join, relative, resolve } from "node:path";
import findFiles from "fast-glob";
import { analyzeControllerRoutes } from "./controller-routes.ts";
import { emitControllerInvokers } from "./controller-invokers.ts";
import { descriptorModuleFileName, emitModuleDescriptors } from "./descriptor-emitter.ts";
import { writePendingFiles } from "./file-writer.ts";
import { formatGeneratedSource } from "./generated-source-formatter.ts";
import { analyzeModuleDescriptors } from "./module-descriptors.ts";
import {
  readConfiguration,
  resolveInside,
  resolveProject,
  toImportPath,
} from "./project-configuration.ts";
import { collectSourceImports } from "./source-imports.ts";
import type { AnalyzedController } from "./controller-routes.types.ts";
import type { DescriptorSourceFile } from "./descriptor-emitter.types.ts";
import type { GenerateInvokersOptions, GenerateInvokersResult } from "./invoker-generator.types.ts";
import type { PendingFile } from "./schematic.types.ts";
import { aponiaVersion } from "../version.ts";

/**
 * The file a build writes, relative to the configured source root. It is a
 * fixed name so an application's entrypoint can import it without configuration.
 */
export const invokerModuleFileName = "invokers.generated.ts";

/**
 * Reads every source file under the configured source root and writes the two
 * modules a build generates.
 *
 * The invoker module is literal route binding: the runtime otherwise builds each
 * invoker with `new Function` and infers a handler's bindings from its own
 * source. The descriptor module is the application's module graph as data, so it
 * can boot without lowering decorated classes at all.
 *
 * Both emitters cover what they can prove and decline the rest, so a partially
 * generated application is a supported state and this never has to fail because
 * one declaration was unusual: a declined handler stays on the runtime's compile
 * path, and a declined module keeps booting from its decorators. The descriptor
 * module is only written when at least one module could be declared, so a
 * project that has controllers but no `@Module()` still gets its invokers.
 *
 * Both modules are written through the project's own formatter, so the file that
 * lands is one the application's `vp check` accepts rather than one that merely
 * looks close to it. `generated-source-formatter.ts` owns that lookup and
 * records why it is resolved at run time instead of declared.
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
  const descriptorPath = join(sourceRoot, descriptorModuleFileName);

  const sourceFiles = await findFiles("**/*.ts", {
    cwd: sourceRoot,
    absolute: true,
    ignore: [
      "**/*.spec.ts",
      "**/*.test.ts",
      `**/${invokerModuleFileName}`,
      `**/${descriptorModuleFileName}`,
    ],
  });

  const found: { readonly controller: AnalyzedController; readonly file: string }[] = [];
  const analyzed: DescriptorSourceFile[] = [];
  for (const file of sourceFiles.toSorted()) {
    const source = await Bun.file(file).text();
    const controllers = analyzeControllerRoutes(source, file);
    for (const controller of controllers) {
      found.push({ controller, file });
    }

    analyzed.push({
      file,
      imports: collectSourceImports(source, file),
      descriptors: analyzeModuleDescriptors(source, file),
      controllers,
    });
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
    Object.freeze({ framework: aponiaVersion, elysia: await resolveElysiaVersion(projectRoot) }),
  );
  if (emitted.source === undefined) {
    const [first] = emitted.declined;
    throw new Error(
      `No handler could be generated for. The first was "${first?.controller}.${first?.method}": ${first?.reason}.`,
    );
  }

  const descriptors = emitModuleDescriptors(analyzed, descriptorPath);
  // Regenerating is the normal case, so a file is replaced rather than refused
  // when it is already there. The descriptor module is written only when
  // something could be declared for it: every application that reaches this
  // command has controllers, and not all of them declare modules.
  const pending: PendingFile[] = [
    {
      path: outputPath,
      content: await formatGeneratedSource(projectRoot, invokerModuleFileName, emitted.source),
      kind: (await Bun.file(outputPath).exists()) ? "UPDATE" : "CREATE",
    },
  ];
  if (descriptors.source !== undefined) {
    pending.push({
      path: descriptorPath,
      content: await formatGeneratedSource(
        projectRoot,
        descriptorModuleFileName,
        descriptors.source,
      ),
      kind: (await Bun.file(descriptorPath).exists()) ? "UPDATE" : "CREATE",
    });
  }

  const result = await writePendingFiles(projectRoot, pending, options.dryRun);
  return { ...result, declined: descriptors.declined };
}

/**
 * The Elysia version the project has installed, or `null` when none resolves.
 *
 * The generated artifact records this as provenance, and the platform reports it
 * when it refuses the artifact, so a version mismatch names both sides. The
 * lookup is deliberately best-effort: this command reads a project's source, and
 * requiring an installed Elysia would make it fail on a checkout that has not
 * been installed yet, which is not a fault in the project being built.
 */
async function resolveElysiaVersion(projectRoot: string): Promise<string | null> {
  try {
    const manifestPath = Bun.resolveSync("elysia/package.json", projectRoot);
    const manifest = (await Bun.file(manifestPath).json()) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}
