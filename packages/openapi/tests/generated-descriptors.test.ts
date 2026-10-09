import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import type {
  AponiaApplicationOptions,
  AponiaModuleDescriptorArtifact,
  ElysiaPlugin,
} from "@aponiajs/platform-elysia";
import { openapi } from "@elysia/openapi";
import {
  analyzeControllerRoutes,
  analyzeModuleDescriptors,
  collectSourceImports,
  emitModuleDescriptors,
} from "@aponiajs/cli";
import type { DeclinedDescriptor, DescriptorSourceFile } from "@aponiajs/cli";
import type { ServedDocument } from "./served-document.ts";

/**
 * What `aponia build` reads versus what a boot serves.
 *
 * The document is a function of the route table the platform compiled, so the
 * question this file answers is whether a graph lowered from the generated
 * descriptors answers with the same routes as one lowered from its decorators —
 * the acceptance criterion the CLI's own integration test states for the
 * descriptor artifact, restated for the document this package serves.
 *
 * The emitter is `@aponiajs/cli`'s and the descriptor authoring surface it emits
 * calls is `@aponiajs/platform-elysia`'s, so this is the only place the two
 * halves meet with a document on top. That is why this package carries the CLI as
 * a development dependency; its `tsconfig.json` maps the package name at the
 * source, because the artifact has to be read from source rather than from a
 * build this lane does not run.
 */

/**
 * The version the running platform reports, read from the manifest it ships
 * rather than imported from the module under test, so the artifact this file
 * generates cannot accidentally agree with a broken platform.
 */
const frameworkVersion = (
  (await Bun.file(new URL("../../platform-elysia/package.json", import.meta.url)).json()) as {
    version: string;
  }
).version;

/**
 * The provenance the artifact is generated with. The Elysia field is recorded
 * rather than compared — the platform only names it when it refuses an artifact
 * from another release — so a stated value keeps this file from depending on what
 * the machine happened to install.
 */
const provenance = Object.freeze({ framework: frameworkVersion, elysia: "2.0.0-beta.24" });

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/**
 * A project two ways at once.
 *
 * `WidgetsModule` is a module whose `imports` hold nothing but a controller, so
 * `aponia build` lowers it and the artifact carries its declaration.
 * `AppModule` is the shape this package is consumed in — a module whose `imports`
 * hold the registration — and the contrast between the two is the whole point of
 * the second and third cases below.
 *
 * `docs.ts` reaches the package through a relative path rather than through its
 * published name, because the fixture is written inside this package's own
 * `node_modules` and a self-reference is not a name the workspace resolves.
 */
const sources: Readonly<Record<string, string>> = {
  "widgets.model.ts": `import { Validation } from "@aponiajs/common";
import { t } from "elysia";

const createWidgetSchema = t.Object({ name: t.String({ minLength: 2 }) });
const widgetResponseSchema = t.Object({ id: t.String(), name: t.String() });
const errorResponseSchema = t.Object({ message: t.String() });

@Validation(createWidgetSchema)
export class CreateWidget {}
export interface CreateWidget {
  readonly name: string;
}

@Validation(widgetResponseSchema)
export class WidgetResponse {}
export interface WidgetResponse {
  readonly id: string;
  readonly name: string;
}

@Validation(errorResponseSchema)
export class ErrorResponse {}
export interface ErrorResponse {
  readonly message: string;
}
`,
  "widgets.controller.ts": `import { Body, Controller, Get, Param, Post } from "@aponiajs/common";
import { CreateWidget, ErrorResponse, WidgetResponse } from "./widgets.model.ts";

@Controller("widgets")
export class WidgetsController {
  @Get(":id")
  read(@Param("id") id: string): WidgetResponse {
    return { id, name: "widget" };
  }

  @Post("/", { body: CreateWidget, response: { 201: WidgetResponse, 404: ErrorResponse } })
  create(@Body() body: CreateWidget): WidgetResponse {
    return { id: "1", name: body.name };
  }

  @Get("/health")
  health(): string {
    return "ok";
  }
}
`,
  "widgets.module.ts": `import { Module } from "@aponiajs/common";
import { WidgetsController } from "./widgets.controller.ts";

@Module({ controllers: [WidgetsController] })
export class WidgetsModule {}
`,
  "docs.ts": `import { defineConfiguration } from "@aponiajs/common";
import { z } from "zod";
import { OpenApiModule } from "../../src/index.ts";

const OpenApiConfig = defineConfiguration(
  z
    .object({ OPENAPI_TITLE: z.string().min(1).default("Generated graph") })
    .transform(({ OPENAPI_TITLE }) => ({
      info: {
        title: OPENAPI_TITLE,
        version: "3.0.0",
        description: "from the generated graph",
      },
    })),
  "openapi.generated",
);

export const document = OpenApiModule.register({
  configuration: OpenApiConfig,
  source: {},
});
`,
  "app.module.ts": `import { Module } from "@aponiajs/common";
import { WidgetsController } from "./widgets.controller.ts";
import { document } from "./docs.ts";

@Module({ imports: [document], controllers: [WidgetsController] })
export class AppModule {}
`,
};

interface GeneratedFixture {
  readonly WidgetsModule: unknown;
  readonly AppModule: unknown;
  readonly moduleDescriptorArtifact: AponiaModuleDescriptorArtifact;
  readonly declined: readonly DeclinedDescriptor[];
}

/**
 * Writes the fixture and the module a build would generate beside it.
 *
 * Written inside this package's `node_modules` so the generated module and the
 * fixture resolve the workspace from the same place an application would, and
 * removed again after every case that reads it.
 */
async function generateFixture(): Promise<GeneratedFixture> {
  const directory = await mkdtemp(join(import.meta.dir, "..", "node_modules", ".aponia-openapi-"));
  temporaryDirectories.push(directory);

  const files: DescriptorSourceFile[] = [];
  for (const [name, source] of Object.entries(sources)) {
    const path = join(directory, name);
    await Bun.write(path, source);
    files.push({
      file: path,
      imports: collectSourceImports(source, path),
      descriptors: analyzeModuleDescriptors(source, path),
      controllers: analyzeControllerRoutes(source, path),
    });
  }

  const generatedPath = join(directory, "descriptors.generated.ts");
  const emitted = emitModuleDescriptors(files, generatedPath, provenance);
  if (emitted.source === undefined) {
    throw new Error(`The emitter declined every module: ${JSON.stringify(emitted.declined)}`);
  }
  await Bun.write(generatedPath, emitted.source);

  const [widgets, app, generated] = await Promise.all([
    import(join(directory, "widgets.module.ts")) as Promise<{ WidgetsModule: unknown }>,
    import(join(directory, "app.module.ts")) as Promise<{ AppModule: unknown }>,
    import(generatedPath) as Promise<{ moduleDescriptorArtifact: AponiaModuleDescriptorArtifact }>,
  ]);

  return {
    WidgetsModule: widgets.WidgetsModule,
    AppModule: app.AppModule,
    moduleDescriptorArtifact: generated.moduleDescriptorArtifact,
    declined: emitted.declined,
  };
}

/**
 * The plugin the module-only boots in this file mount, held constant on purpose.
 *
 * This file asks what the platform's route lowering puts in a document, not what
 * this package's module configures, so the plugin is mounted directly through the
 * application's own `plugins` option rather than through a registration. A boot
 * whose root carries a registration mounts nothing here instead: the registration
 * is the subject of that case, and Elysia mounts a named plugin once, so a second
 * instance would take the document over.
 */
function documentPlugin(): ElysiaPlugin {
  return openapi({
    documentation: { info: { title: "Declared and decorated", version: "3.0.0" } },
    exclude: { methods: ["options", "ws"] },
  });
}

async function documentOf(
  rootModule: unknown,
  plugins: readonly ElysiaPlugin[],
  options: AponiaApplicationOptions = {},
): Promise<ServedDocument> {
  const application = await AponiaFactory.create(rootModule as never, {
    logger: false,
    plugins: [...plugins],
    ...options,
  });

  try {
    const response = await application.handle(new Request("http://localhost/openapi/json"));

    expect(response.status).toBe(200);

    return (await response.json()) as ServedDocument;
  } finally {
    await application.close();
  }
}

test("a document built from a generated descriptor module is the document the decorators build", async (): Promise<void> => {
  const fixture = await generateFixture();

  const decorated = await documentOf(fixture.WidgetsModule, [documentPlugin()]);
  // Both readings of the artifact are exercised, because they are two different
  // facts: booting the descriptor directly is what the generated module supports
  // on its own, and booting the module the application names with the artifact is
  // what a generated application does, where the platform decides which graph
  // serves the request.
  const declared = await documentOf(fixture.moduleDescriptorArtifact.modules.WidgetsModule, [
    documentPlugin(),
  ]);
  const adopted = await documentOf(fixture.WidgetsModule, [documentPlugin()], {
    descriptors: fixture.moduleDescriptorArtifact,
  });

  expect(declared).toEqual(decorated);
  expect(adopted).toEqual(decorated);

  // The document is not empty and not merely equal: the routes, the declared
  // body, and the status-specific responses all survive the lowering, which is
  // what makes the comparison above worth making.
  expect(Object.keys(decorated.paths)).toEqual(["/widgets/{id}", "/widgets", "/widgets/health"]);
  expect(
    decorated.paths["/widgets"]?.post?.requestBody?.content["application/json"]?.schema,
  ).toEqual({
    type: "object",
    properties: { name: { minLength: 2, type: "string" } },
    required: ["name"],
  });
  expect(Object.keys(decorated.paths["/widgets"]?.post?.responses ?? {})).toEqual(["201", "404"]);
  expect(decorated.components.schemas).toEqual({});
});

test("carries only the modules a build can lower into the generated artifact", async (): Promise<void> => {
  const fixture = await generateFixture();

  // The module whose `imports` hold controllers is lowered; the module whose
  // `imports` hold a registration is not, and the artifact says so by holding
  // nothing for it.
  expect(Object.keys(fixture.moduleDescriptorArtifact.modules)).toEqual(["WidgetsModule"]);
  expect(fixture.declined).toHaveLength(1);
  expect(fixture.declined[0]?.module).toBe("AppModule");
  expect(fixture.declined[0]?.reason).toContain('"document"');
  expect(fixture.declined[0]?.reason).toContain('"imports"');
});

test("serves the document of a module the build declined, by lowering it from its decorators", async (): Promise<void> => {
  const fixture = await generateFixture();

  // `AppModule` imports the registration, so `aponia build` declines it and the
  // artifact holds no declaration for the module the application names. The
  // platform refuses the artifact for that root rather than booting a graph
  // without it, and lowers the root from its decorators instead — so the
  // application is whole and its own registration serves the document. What the
  // decline costs is the lowering, not the application.
  const compiled = await documentOf(fixture.AppModule, []);
  const adopted = await documentOf(fixture.AppModule, [], {
    descriptors: fixture.moduleDescriptorArtifact,
  });

  expect(adopted).toEqual(compiled);
  expect(compiled.info).toEqual({
    title: "Generated graph",
    version: "3.0.0",
    description: "from the generated graph",
  });
  expect(compiled.paths["/widgets"]?.post?.operationId).toBe("postWidgets");
});
