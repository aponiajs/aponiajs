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
} from "../src/index.ts";
import type { DescriptorSourceFile } from "../src/index.ts";

/**
 * The acceptance criterion for enhancers carried through the descriptor
 * artifact: an application booted from the generated descriptor refuses exactly
 * what a decorated one refuses.
 *
 * `@UseGuards()`, `@UseInterceptors()`, and `@UseFilters()` are declarations the
 * decorated path lowers while it mounts, so a build that read the route but not
 * its enhancers would leave the generated route open where the decorated route
 * was closed. This is the only place the emitter and the runtime that consumes
 * its output meet, so the refusal is asserted through `application.handle` and
 * the status the platform answers with.
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

/** The provenance the artifact is generated with, recorded rather than compared. */
const provenance = Object.freeze({ framework: frameworkVersion, elysia: "1.4.30" });

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const sources: Readonly<Record<string, string>> = {
  "auth.guard.ts": `import { Injectable, type CanActivate } from "@aponiajs/common";

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}
`,
  "admin.controller.ts": `import { Controller, Get, UseGuards } from "@aponiajs/common";
import { AuthGuard } from "./auth.guard.ts";

@Controller("admin")
export class AdminController {
  @Get("open")
  open(): string {
    return "open";
  }

  @UseGuards(AuthGuard)
  @Get("locked")
  locked(): string {
    return "locked";
  }
}
`,
  "admin.module.ts": `import { Module } from "@aponiajs/common";
import { AdminController } from "./admin.controller.ts";
import { AuthGuard } from "./auth.guard.ts";

@Module({ controllers: [AdminController], providers: [AuthGuard] })
export class AdminModule {}
`,
};

interface Fixture {
  readonly AdminModule: unknown;
  readonly source: string;
  readonly moduleDescriptorArtifact: AponiaModuleDescriptorArtifact;
}

/**
 * Writes the fixture and the module a build would generate beside it, exactly as
 * `aponia build` would: the same analysis, the same emitter, the same artifact.
 */
async function generateFixture(): Promise<Fixture> {
  const directory = await mkdtemp(
    join(import.meta.dir, "..", "node_modules", ".aponia-descriptors-enhancers-"),
  );
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
  if (emitted.declined.length > 0) {
    throw new Error(`The emitter declined a declaration: ${JSON.stringify(emitted.declined)}`);
  }
  await Bun.write(generatedPath, emitted.source);

  const [module, generated] = await Promise.all([
    import(join(directory, "admin.module.ts")) as Promise<Fixture>,
    import(generatedPath) as Promise<Fixture>,
  ]);

  return {
    AdminModule: module.AdminModule,
    source: emitted.source,
    moduleDescriptorArtifact: generated.moduleDescriptorArtifact,
  };
}

interface Answer {
  readonly status: number;
}

async function answers(
  rootModule: unknown,
  options: AponiaApplicationOptions = {},
): Promise<readonly Answer[]> {
  const application = await AponiaFactory.create(rootModule as never, {
    logger: false,
    ...options,
  });

  try {
    return await Promise.all(
      [
        new Request("http://localhost/admin/open"),
        new Request("http://localhost/admin/locked"),
      ].map(async (request) => {
        const response = await application.handle(request);
        return { status: response.status };
      }),
    );
  } finally {
    await application.close();
  }
}

test("a generated descriptor module enforces the enhancers its decorators declared", async () => {
  const fixture = await generateFixture();

  const compiled = await answers(fixture.AdminModule);
  // Both readings of the artifact are exercised: booting the descriptor the
  // emitter produced directly, and naming the decorated root with the artifact,
  // which is what a generated application does.
  const declared = await answers(fixture.moduleDescriptorArtifact.modules.AdminModule);
  const adopted = await answers(fixture.AdminModule, {
    descriptors: fixture.moduleDescriptorArtifact,
  });

  expect(declared).toEqual(compiled);
  expect(adopted).toEqual(compiled);
  // The unguarded route answers, and the guarded one is refused: `AuthGuard`
  // returns `false`, which the platform answers with `403`.
  expect(compiled.map((answer) => answer.status)).toEqual([200, 403]);

  // The generated route states the guard, which is what the platform resolves
  // while it mounts the declared controller.
  expect(fixture.source).toContain("guards: [AuthGuard],");
});
