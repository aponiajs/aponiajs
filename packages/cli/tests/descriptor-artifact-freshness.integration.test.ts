import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import type { LoggerService } from "@aponiajs/common";
import type { AponiaModuleDescriptorArtifact } from "@aponiajs/platform-elysia";
import { generateInvokers } from "../src/index.ts";

/**
 * The regression for a descriptor artifact a source change left stale.
 *
 * `aponia build` only overwrites the descriptor module when it can declare a
 * module. When a source change makes the root module undeclarable and no other
 * module can be lowered, the build used to write nothing and leave the previous
 * artifact on disk, and the platform adopted it whole: the artifact matched the
 * framework stamp, was well-formed, and held a declaration for the root the
 * application named. The boot then served the graph the application had before
 * the change — answering the platform's `404` where the source declared a route
 * — which is exactly the "fewer declarations than the application wrote" defect
 * the artifact promises never to cause.
 *
 * The fixture mirrors the probe: phase 1 boots a project whose only module is
 * declarable, so a descriptor is written; phase 2 adds a route and an `imports`
 * collection the build cannot read, so the root can no longer be declared and
 * nothing else can be lowered; the boot that follows must answer the route the
 * phase-2 source declares.
 */

class RecordingLogger implements LoggerService {
  readonly records: { readonly context: string; readonly message: string }[] = [];

  log(message: unknown, context?: unknown): void {
    this.records.push({
      context: typeof context === "string" ? context : "",
      message: String(message),
    });
  }

  fatal(): void {}
  error(): void {}
  warn(): void {}
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const appControllerSource = `import { Controller, Get } from "@aponiajs/common";

@Controller("/")
export class AppController {
  @Get()
  read(): string {
    return "app";
  }
}
`;

const widgetsControllerSource = `import { Controller, Get } from "@aponiajs/common";

@Controller("widgets")
export class WidgetsController {
  @Get()
  list(): string {
    return "widgets";
  }
}
`;

// Phase 1: the only module declares its controller literally, so a build lowers
// it into the descriptor artifact and a `descriptors.generated.ts` lands on disk.
const declarableAppModule = `import { Module } from "@aponiajs/common";
import { AppController } from "./app.controller.ts";

@Module({ controllers: [AppController] })
export class AppModule {}
`;

// Phase 2: the application gains a route and an `imports` collection the build
// cannot read statically, so the root module is undeclarable. This is the shape
// `docs/plugin-packages.md` describes: an `imports` entry that is not a single
// identifier naming a declaration read from the project's own source declines
// the module that wrote it, and the route it registers still mounts at run time.
const undeclarableAppModule = `import { Module } from "@aponiajs/common";
import { AppController } from "./app.controller.ts";
import { WidgetsController } from "./widgets.controller.ts";

const widgets = [];

@Module({ imports: widgets, controllers: [AppController, WidgetsController] })
export class AppModule {}
`;

interface Fixture {
  readonly AppModule: unknown;
  readonly moduleDescriptorArtifact: AponiaModuleDescriptorArtifact;
}

/**
 * Runs a build whose root module is declarable, then changes the source so the
 * root is undeclarable, runs a second build, and returns what both builds left
 * on disk.
 *
 * The fixture is written under this package's `node_modules` so the generated
 * module and the application it imports resolve the workspace packages from the
 * repository root, the same way a generated application does.
 */
async function buildThroughSourceChange(): Promise<Fixture> {
  const directory = await mkdtemp(
    join(import.meta.dir, "..", "node_modules", ".aponia-freshness-"),
  );
  temporaryDirectories.push(directory);
  const sourceRoot = join(directory, "src");
  await mkdir(sourceRoot, { recursive: true });
  await Bun.write(join(directory, "aponia.json"), `${JSON.stringify({ sourceRoot: "src" })}\n`);
  await Bun.write(join(sourceRoot, "app.controller.ts"), appControllerSource);
  await Bun.write(join(sourceRoot, "app.module.ts"), declarableAppModule);

  const first = await generateInvokers({ cwd: directory, dryRun: false });
  expect(first.changes).toEqual([
    { kind: "CREATE", path: join("src", "invokers.generated.ts") },
    { kind: "CREATE", path: join("src", "descriptors.generated.ts") },
  ]);

  await Bun.write(join(sourceRoot, "widgets.controller.ts"), widgetsControllerSource);
  await Bun.write(join(sourceRoot, "app.module.ts"), undeclarableAppModule);

  const second = await generateInvokers({ cwd: directory, dryRun: false });
  expect(second.declined).toEqual([
    {
      kind: "module",
      module: "AppModule",
      reason:
        `@Module in ${join(sourceRoot, "app.module.ts")} must declare "imports" as an array literal ` +
        "to be read statically.",
    },
  ]);

  const [module, generated] = await Promise.all([
    import(join(sourceRoot, "app.module.ts")) as Promise<{ AppModule: unknown }>,
    import(join(sourceRoot, "descriptors.generated.ts")) as Promise<{
      moduleDescriptorArtifact: AponiaModuleDescriptorArtifact;
    }>,
  ]);

  return {
    AppModule: module.AppModule,
    moduleDescriptorArtifact: generated.moduleDescriptorArtifact,
  };
}

async function answer(
  rootModule: unknown,
  options: {
    readonly descriptors?: AponiaModuleDescriptorArtifact;
    readonly logger?: LoggerService;
  },
): Promise<{ readonly status: number; readonly body: string }> {
  const application = await AponiaFactory.create(rootModule as never, {
    logger: options.logger ?? false,
    ...(options.descriptors === undefined ? {} : { descriptors: options.descriptors }),
  });

  try {
    const response = await application.handle(new Request("http://localhost/widgets"));
    return { status: response.status, body: await response.text() };
  } finally {
    await application.close();
  }
}

test("a source change that makes the root undeclarable does not leave a stale artifact serving it", async () => {
  const fixture = await buildThroughSourceChange();
  const logger = new RecordingLogger();

  const compiled = await answer(fixture.AppModule, {});
  const adopted = await answer(fixture.AppModule, {
    descriptors: fixture.moduleDescriptorArtifact,
    logger,
  });

  // The route the phase-2 source declares has to answer with the same body the
  // decorated boot gives it, whether or not the artifact is handed over.
  expect(compiled).toEqual({ status: 200, body: "widgets" });
  expect(adopted).toEqual(compiled);

  // The mechanism: the artifact on disk no longer holds a declaration for the
  // named root, so it is refused and the decorated graph is lowered instead.
  expect(fixture.moduleDescriptorArtifact.modules).toEqual({});
  expect(logger.records).toContainEqual({
    context: "RoutesResolver",
    message:
      'The generated module descriptors hold no declaration for "AppModule", so it is lowered from its ' +
      "decorators instead. Run `aponia build` again.",
  });
});
