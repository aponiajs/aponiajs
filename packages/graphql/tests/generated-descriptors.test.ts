import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import type {
  AponiaApplicationOptions,
  AponiaModuleDescriptorArtifact,
} from "@aponiajs/platform-elysia";
import {
  analyzeControllerRoutes,
  analyzeModuleDescriptors,
  collectSourceImports,
  emitModuleDescriptors,
} from "@aponiajs/cli";
import type { DeclinedDescriptor, DescriptorSourceFile } from "@aponiajs/cli";

/**
 * What `aponia build` reads versus what a boot serves.
 *
 * A registration is a `DynamicModule` — a runtime value rather than a
 * declaration read from the project's own source — so `aponia build` cannot
 * lower the module that names one. The question this file answers is what that
 * costs: the module is declined, the artifact holds nothing for it, and the
 * application still boots and still answers GraphQL with its endpoint, because
 * the platform lowers a root the artifact does not carry from its decorators
 * instead.
 *
 * The emitter is `@aponiajs/cli`'s and the descriptor authoring surface it emits
 * calls is `@aponiajs/platform-elysia`'s, so this is the only place the two
 * halves meet with a registration on top. That is why this package carries the
 * CLI as a development dependency; its `tsconfig.json` maps the package name at
 * the source, because the artifact has to be read from source rather than from a
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
 * `PingModule` is a module whose `imports` hold nothing but a controller, so
 * `aponia build` lowers it and the artifact carries its declaration. `AppModule`
 * is the shape this package is consumed in — a module whose `imports` hold the
 * registration — and the contrast between the two is the whole point of the
 * cases below.
 *
 * The fixture reaches the package through a relative path rather than through
 * its published name, because it is written inside this package's own
 * `node_modules` and a self-reference is not a name the workspace resolves.
 */
const sources: Readonly<Record<string, string>> = {
  "ping.controller.ts": `import { Controller, Get } from "@aponiajs/common";

@Controller("ping")
export class PingController {
  @Get("/")
  ping(): string {
    return "pong";
  }
}
`,
  "ping.module.ts": `import { Module } from "@aponiajs/common";
import { PingController } from "./ping.controller.ts";

@Module({ controllers: [PingController] })
export class PingModule {}
`,
  "graphql.ts": `import { defineConfiguration } from "@aponiajs/common";
import { z } from "zod";
import { GraphQLModule } from "../../src/index.ts";

const GraphQLConfig = defineConfiguration(
  z
    .object({ GRAPHQL_PATH: z.string().min(1).default("/graphql") })
    .transform(({ GRAPHQL_PATH }) => ({ path: GRAPHQL_PATH })),
  "graphql.generated",
);

const typeDefs = \`type Query { hello: String }\`;
const resolvers = { Query: { hello: () => "world" } };

export const endpoint = GraphQLModule.register({
  configuration: GraphQLConfig,
  source: {},
  useFactory: () => ({ typeDefs, resolvers }),
});
`,
  "app.module.ts": `import { Module } from "@aponiajs/common";
import { PingController } from "./ping.controller.ts";
import { endpoint } from "./graphql.ts";

@Module({ imports: [endpoint], controllers: [PingController] })
export class AppModule {}
`,
};

interface GeneratedFixture {
  readonly PingModule: unknown;
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
  const directory = await mkdtemp(join(import.meta.dir, "..", "node_modules", ".aponia-graphql-"));
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

  const [ping, app, generated] = await Promise.all([
    import(join(directory, "ping.module.ts")) as Promise<{ PingModule: unknown }>,
    import(join(directory, "app.module.ts")) as Promise<{ AppModule: unknown }>,
    import(generatedPath) as Promise<{ moduleDescriptorArtifact: AponiaModuleDescriptorArtifact }>,
  ]);

  return {
    PingModule: ping.PingModule,
    AppModule: app.AppModule,
    moduleDescriptorArtifact: generated.moduleDescriptorArtifact,
    declined: emitted.declined,
  };
}

/** The GraphQL answer one boot gave, so an assertion names only what it is about. */
async function helloOf(
  rootModule: unknown,
  options: AponiaApplicationOptions = {},
): Promise<unknown> {
  const application = await AponiaFactory.create(rootModule as never, {
    logger: false,
    ...options,
  });

  try {
    const response = await application.handle(
      new Request("http://localhost/graphql?query={hello}"),
    );

    expect(response.status).toBe(200);

    return await response.json();
  } finally {
    await application.close();
  }
}

test("carries only the modules a build can lower into the generated artifact", async (): Promise<void> => {
  const fixture = await generateFixture();

  // The module whose `imports` hold controllers is lowered; the module whose
  // `imports` hold a registration is not, and the artifact says so by holding
  // nothing for it.
  expect(Object.keys(fixture.moduleDescriptorArtifact.modules)).toEqual(["PingModule"]);
  expect(fixture.declined).toHaveLength(1);
  expect(fixture.declined[0]?.module).toBe("AppModule");
  expect(fixture.declined[0]?.reason).toContain('"endpoint"');
  expect(fixture.declined[0]?.reason).toContain('"imports"');
});

test("answers with the endpoint of a module the build declined, by lowering it from its decorators", async (): Promise<void> => {
  const fixture = await generateFixture();

  // `AppModule` imports the registration, so `aponia build` declines it and the
  // artifact holds no declaration for the module the application names. The
  // platform lowers the root from its decorators instead, so the application is
  // whole and its own registration answers. What the decline costs is the
  // lowering, not the endpoint.
  const compiled = await helloOf(fixture.AppModule);
  const adopted = await helloOf(fixture.AppModule, {
    descriptors: fixture.moduleDescriptorArtifact,
  });

  expect(adopted).toEqual(compiled);
  expect(compiled).toEqual({ data: { hello: "world" } });
});
