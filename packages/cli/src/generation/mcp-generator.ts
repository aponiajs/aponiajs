import { basename, join, relative } from "node:path";
import { createFile, writePendingFiles } from "./file-writer.ts";
import { createComponentNames } from "./component-names.ts";
import type { GenerateSchematicOptions, GenerateSchematicResult } from "./schematic.types.ts";
import {
  findModuleFile,
  readConfiguration,
  resolveInside,
  resolveProject,
} from "./project-configuration.ts";
import { registerInModule } from "./module-registration.ts";

/**
 * Generates one MCP feature module with a decorated tools provider.
 *
 * @param projectRoot - The workspace root.
 * @param name - The feature name.
 * @param options - The generation flags.
 * @returns The change lines the CLI prints.
 */
export async function generateMcpFeature(
  projectRoot: string,
  name: string,
  options: GenerateSchematicOptions,
): Promise<GenerateSchematicResult> {
  const configuration = await readConfiguration(projectRoot);
  const project = resolveProject(configuration, options.project);
  const names = createComponentNames(name);
  const sourceRoot = resolveInside(
    projectRoot,
    project.sourceRoot ?? configuration.sourceRoot ?? "src",
  );
  const basePath = options.flat ? sourceRoot : join(sourceRoot, names.fileName);
  const library = project.type === "library";
  const files = [
    createFile(basePath, `${names.fileName}.tools.ts`, toolsSource(names)),
    createFile(basePath, `${names.fileName}.module.ts`, moduleSource(names)),
    ...(options.spec === false
      ? []
      : [createFile(basePath, `${names.fileName}.tools.spec.ts`, specSource(names))]),
  ];
  const written = await writePendingFiles(projectRoot, files, options.dryRun);

  if (!library) {
    const moduleFile = await findModuleFile({ sourceRoot, fromDirectory: sourceRoot });
    if (moduleFile === undefined) {
      throw new Error("Could not find the root module to register the MCP feature in.");
    }
    let source = await Bun.file(moduleFile).text();
    const importsPath = relative(projectRoot, join(basePath, `${names.fileName}.module.ts`))
      .replaceAll("\\", "/")
      .replace(/\.ts$/, "");
    source = registerInModule(
      source,
      "imports",
      `${names.className}Module`,
      importsPath.startsWith(".") ? importsPath : `./${importsPath}`,
    );
    source = registerInModule(
      source,
      "imports",
      `McpModule.forRoot({ name: ${JSON.stringify(basename(projectRoot))}, version: "0.0.1" })`,
      "@aponiajs/mcp",
    );
    if (!options.dryRun) {
      await Bun.write(moduleFile, source);
    }
    await addDependencies(projectRoot, options);
  }

  return written;
}

function toolsSource(names: ReturnType<typeof createComponentNames>): string {
  return `import { Injectable } from "@aponiajs/common";
import { Tool, type McpContext } from "@aponiajs/mcp";
import { z } from "zod";

/** The tools ${names.className} publishes. */
@Injectable()
export class ${names.className}Tools {
  /** Answers the model's first call. */
  @Tool({
    description: "Describe what ${names.className} exposes",
    inputSchema: z.object({}),
  })
  describe(_input: unknown, _context: McpContext): string {
    return "${names.className}";
  }
}
`;
}

function moduleSource(names: ReturnType<typeof createComponentNames>): string {
  return `import { Module } from "@aponiajs/common";
import { ${names.className}Tools } from "./${names.fileName}.tools.ts";

/** The module the application imports to publish the ${names.className} tools. */
@Module({
  providers: [${names.className}Tools],
  exports: [${names.className}Tools],
})
export class ${names.className}Module {}
`;
}

function specSource(names: ReturnType<typeof createComponentNames>): string {
  return `import { expect, test } from "bun:test";
import { compileRootModule } from "@aponiajs/platform-core";
import { createContainer } from "@aponiajs/core";
import { ${names.className}Module } from "./${names.fileName}.module.ts";
import { ${names.className}Tools } from "./${names.fileName}.tools.ts";

test("resolves the tools provider", () => {
  const container = createContainer(compileRootModule(${names.className}Module));
  expect(container.get(${names.className}Tools)).toBeDefined();
});
`;
}

async function addDependencies(
  projectRoot: string,
  options: GenerateSchematicOptions,
): Promise<void> {
  if (options.dryRun) {
    return;
  }

  for (const candidate of [join(projectRoot, "apps", options.project ?? ""), projectRoot]) {
    const path = join(candidate, "package.json");
    const file = Bun.file(path);
    if (!(await file.exists())) {
      continue;
    }
    const manifest = (await file.json()) as {
      dependencies?: Record<string, string>;
      [key: string]: unknown;
    };
    const dependencies = { ...manifest.dependencies };
    dependencies["@aponiajs/mcp"] = "workspace:*";
    dependencies["@modelcontextprotocol/server"] = "^2.4.0";
    dependencies.zod ??= "^4.6.6";
    await Bun.write(path, `${JSON.stringify({ ...manifest, dependencies }, undefined, 2)}\n`);
    return;
  }
}
