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
 * application still boots and still traces, because the platform lowers a root
 * the artifact does not carry from its decorators instead.
 *
 * The emitter is `@aponiajs/cli`'s and the descriptor authoring surface it emits
 * calls is `@aponiajs/platform-elysia`'s, so this is the only place the two
 * halves meet with a registration on top. That is why this package carries the
 * CLI as a development dependency; its `tsconfig.json` maps the package name at
 * the source, because the artifact has to be read from source rather than from a
 * build this lane does not run.
 *
 * What the fixture asserts about tracing is the one claim that survives this
 * package's process-global SDK: `getCurrentSpan()` inside the handler, not the
 * exporter. Which registration owns the process is a fact another file in this
 * package measures, and a claim about the span list here would depend on which
 * file Bun happened to load first.
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
const provenance = Object.freeze({ framework: frameworkVersion, elysia: "2.0.0-beta.19" });

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
import { getCurrentSpan } from "@elysia/opentelemetry";

@Controller("ping")
export class PingController {
  @Get("/")
  ping(): string {
    const seen = (globalThis as unknown as { __otelSpans: string[] }).__otelSpans;
    seen.push(getCurrentSpan()?.spanContext().spanId ? "traced" : "untraced");
    return "pong";
  }
}
`,
  "ping.module.ts": `import { Module } from "@aponiajs/common";
import { PingController } from "./ping.controller.ts";

@Module({ controllers: [PingController] })
export class PingModule {}
`,
  "tracing.ts": `import { defineConfiguration } from "@aponiajs/common";
import { z } from "zod";
import { OpentelemetryModule } from "../../src/index.ts";

const TracingConfig = defineConfiguration(
  z
    .object({ OTEL_SERVICE_NAME: z.string().min(1).default("aponia-generated") })
    .transform(({ OTEL_SERVICE_NAME }) => ({ serviceName: OTEL_SERVICE_NAME })),
  "opentelemetry.generated",
);

export const tracing = OpentelemetryModule.register({
  configuration: TracingConfig,
  source: {},
});
`,
  "app.module.ts": `import { Module } from "@aponiajs/common";
import { PingController } from "./ping.controller.ts";
import { tracing } from "./tracing.ts";

@Module({ imports: [tracing], controllers: [PingController] })
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
  const directory = await mkdtemp(join(import.meta.dir, "..", "node_modules", ".aponia-otel-"));
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

/**
 * One boot of a root module, optionally handed the artifact a build would write,
 * answering with what the handler saw of the request's span.
 *
 * The handler reads `getCurrentSpan()` rather than the exporter, because the
 * wrapped plugin's `NodeSDK` is process-global and whether this boot's own
 * processors are the ones that started is a fact about the whole process rather
 * than about this fixture. What the context carries is this boot's own.
 */
async function tracedThrough(
  rootModule: unknown,
  options: AponiaApplicationOptions = {},
): Promise<{ readonly status: number; readonly seen: readonly string[] }> {
  const store = globalThis as unknown as { __otelSpans: string[] };
  store.__otelSpans = [];

  const application = await AponiaFactory.create(rootModule as never, {
    logger: false,
    ...options,
  });

  try {
    const response = await application.handle(new Request("http://localhost/ping"));

    return { status: response.status, seen: [...store.__otelSpans] };
  } finally {
    await application.close();
    store.__otelSpans = [];
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
  expect(fixture.declined[0]?.reason).toContain('"tracing"');
  expect(fixture.declined[0]?.reason).toContain('"imports"');
});

test("traces a module the build declined, by lowering it from its decorators", async (): Promise<void> => {
  const fixture = await generateFixture();

  // `AppModule` imports the registration, so `aponia build` declines it and the
  // artifact holds no declaration for the module the application names. The
  // platform lowers the root from its decorators instead, so the application is
  // whole and the request is still inside a span. What the decline costs is the
  // lowering, not the tracing.
  const compiled = await tracedThrough(fixture.AppModule);
  const adopted = await tracedThrough(fixture.AppModule, {
    descriptors: fixture.moduleDescriptorArtifact,
  });

  expect(adopted).toEqual(compiled);
  expect(compiled.status).toBe(200);
  expect(compiled.seen).toEqual(["traced"]);
});

test("lowers a module whose imports name no registration", async (): Promise<void> => {
  const fixture = await generateFixture();

  // The other half of the contrast: `PingModule` is lowerable, so its own boot
  // is unaffected by anything this package does — which is what makes the
  // declined module's cost attributable to the registration rather than to the
  // fixture.
  const lowered = await tracedThrough(fixture.PingModule);

  expect(lowered.status).toBe(200);
  expect(lowered.seen).toEqual(["untraced"]);
});
