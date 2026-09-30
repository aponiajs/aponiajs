import { afterEach, expect, spyOn, test } from "bun:test";
import type { BunPlugin } from "bun";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LoggerService } from "@aponiajs/common";
import {
  AponiaFactory,
  type AponiaApplicationOptions,
  type AponiaInvokerArtifact,
  type AponiaModuleDescriptorArtifact,
} from "@aponiajs/platform-elysia";
import {
  buildPlugin,
  buildPluginName,
  descriptorModuleFileName,
  invokerModuleFileName,
} from "../src/index.ts";
import { aponiaVersion } from "../src/version.ts";

/**
 * The acceptance criterion for running generation from the bundler: a build that
 * registers the plugin produces the artifacts *before* the bundler resolves an
 * entrypoint that imports them, and the artifacts it produces are the ones the
 * runtime boots from.
 *
 * The fixtures live under `node_modules` for the same reason the other
 * integration fixtures do: the generated modules import `@aponiajs/common` and
 * `@aponiajs/platform-elysia`, and a real `Bun.build` has to resolve those names
 * from somewhere. This package carries the platform as a development dependency
 * for exactly this; its own source imports nothing from it.
 */
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const serviceSource = `import { Injectable } from "@aponiajs/common";

@Injectable()
export class UsersService {
  read(id: string): string {
    return \`read:\${id}\`;
  }
}
`;

const controllerSource = `import { Controller, Get, Param } from "@aponiajs/common";
import { UsersService } from "./users.service.ts";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(":id")
  read(@Param("id") id: string): string {
    return this.usersService.read(id);
  }
}
`;

const moduleSource = `import { Module } from "@aponiajs/common";
import { UsersController } from "./users.controller.ts";
import { UsersService } from "./users.service.ts";

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
`;

/** An entrypoint whose imports only resolve once the plugin has written them. */
const entryImportingArtifacts = `import { controllerInvokerArtifact } from "./invokers.generated.ts";
import { moduleDescriptorArtifact } from "./descriptors.generated.ts";

export const artifact = controllerInvokerArtifact;
export const descriptors = moduleDescriptorArtifact;
`;

/** An entrypoint that touches nothing the plugin writes. */
const plainEntry = `export const message = "hello";
`;

/**
 * Writes a project the generators can read.
 *
 * `aponia.json` is what makes it a project at all: without it generation refuses
 * to run, which is the failure one case below relies on.
 */
async function createProject(files: Readonly<Record<string, string>>): Promise<string> {
  const directory = await mkdtemp(
    join(import.meta.dir, "..", "node_modules", ".aponia-build-plugin-"),
  );
  temporaryDirectories.push(directory);

  for (const [path, source] of Object.entries({
    "aponia.json": `${JSON.stringify({ sourceRoot: "src" })}\n`,
    ...files,
  })) {
    const file = join(directory, path);
    await mkdir(dirname(file), { recursive: true });
    await Bun.write(file, source);
  }

  return directory;
}

async function build(
  directory: string,
  entry: string,
  plugins: readonly BunPlugin[] = [],
): Promise<string> {
  const logged: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message: unknown) => {
    logged.push(String(message));
  });

  try {
    const result = await Bun.build({
      entrypoints: [join(directory, entry)],
      outdir: join(directory, "dist"),
      target: "bun",
      // The framework packages stay external: what these cases prove is that the
      // generated *relative* modules resolve, which has nothing to do with
      // bundling a third-party dependency, and leaving them in makes every case
      // walk all of Elysia.
      external: ["@aponiajs/common", "@aponiajs/platform-elysia", "elysia"],
      plugins: [...plugins],
    });
    expect(result.success).toBe(true);
  } finally {
    log.mockRestore();
  }

  return logged.join("\n");
}

test("generates both artifacts before the bundler resolves an entrypoint that imports them", async () => {
  const directory = await createProject({
    "src/users.service.ts": serviceSource,
    "src/users.controller.ts": controllerSource,
    "src/users.module.ts": moduleSource,
    "src/main.ts": entryImportingArtifacts,
  });
  const invokerPath = join(directory, "src", invokerModuleFileName);
  const descriptorPath = join(directory, "src", descriptorModuleFileName);
  // Nothing exists yet, so a build that resolved its entrypoint first could only
  // fail with "Could not resolve".
  expect(await Bun.file(invokerPath).exists()).toBe(false);
  expect(await Bun.file(descriptorPath).exists()).toBe(false);

  const logged = await build(directory, "src/main.ts", [buildPlugin({ cwd: directory })]);

  expect(logged).toBe(
    [
      `CREATE ${join("src", invokerModuleFileName)}`,
      `CREATE ${join("src", descriptorModuleFileName)}`,
    ].join("\n"),
  );
  expect(await Bun.file(invokerPath).text()).toContain('"read"');
  expect(await Bun.file(descriptorPath).text()).toContain("UsersModule: UsersModuleDescriptor");
});

test("the artifacts a build writes are the ones the runtime boots from", async () => {
  const directory = await createProject({
    "src/users.service.ts": serviceSource,
    "src/users.controller.ts": controllerSource,
    "src/users.module.ts": moduleSource,
    "src/main.ts": entryImportingArtifacts,
  });
  await build(directory, "src/main.ts", [buildPlugin({ cwd: directory })]);

  const [decorated, generated, invokerModule] = await Promise.all([
    import(join(directory, "src", "users.module.ts")) as Promise<{ readonly UsersModule: unknown }>,
    import(join(directory, "src", descriptorModuleFileName)) as Promise<{
      readonly moduleDescriptorArtifact: AponiaModuleDescriptorArtifact;
    }>,
    import(join(directory, "src", invokerModuleFileName)) as Promise<{
      readonly controllerInvokerArtifact: AponiaInvokerArtifact;
    }>,
  ]);

  // Both artifacts the plugin wrote are handed over the way a generated
  // application hands them over, so what this case proves is the wiring a
  // freshly built project uses rather than the emitters in isolation.
  const logger = new RecordingLogger();
  const compiled = await answers(decorated.UsersModule);
  const built = await answers(decorated.UsersModule, {
    descriptors: generated.moduleDescriptorArtifact,
    invokers: invokerModule.controllerInvokerArtifact,
    logger,
  });

  expect(built).toEqual(compiled);
  expect(compiled).toEqual([{ status: 200, body: "read:7" }]);
  expect(logger.records).toContainEqual({
    context: "RoutesResolver",
    message:
      "Booting UsersModule from the generated module descriptors, so the declared graph serves this application.",
  });
});

test("fails the build when generation fails instead of bundling the artifact already on disk", async () => {
  const staleArtifact = `export const controllerInvokerArtifact = { framework: "stale-start" };\n`;
  const directory = await createProject({
    // No @Controller() anywhere, so generation refuses with a plain Error naming
    // the source root it searched.
    [join("src", invokerModuleFileName)]: staleArtifact,
    "src/main.ts": `import { controllerInvokerArtifact } from "./invokers.generated.ts";\nexport const artifact = controllerInvokerArtifact;\n`,
  });

  const failure = await build(directory, "src/main.ts", [buildPlugin({ cwd: directory })]).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain("@Controller()");
  expect((failure as Error).message).toContain('"src"');
  // The build failed rather than quietly bundling the stale file beside it.
  expect(await Bun.file(join(directory, "src", invokerModuleFileName)).text()).toBe(staleArtifact);
  expect(await Bun.file(join(directory, "src", descriptorModuleFileName)).exists()).toBe(false);
});

test("a build that does not register the plugin leaves the project untouched", async () => {
  const directory = await createProject({
    "src/users.controller.ts": controllerSource,
    "src/users.service.ts": serviceSource,
    "src/main.ts": plainEntry,
  });

  await build(directory, "src/main.ts");

  expect(await Bun.file(join(directory, "src", invokerModuleFileName)).exists()).toBe(false);
  expect(await Bun.file(join(directory, "src", descriptorModuleFileName)).exists()).toBe(false);
});

test("a stale artifact is still refused by the runtime the plugin built for", async () => {
  const directory = await createProject({
    "src/users.service.ts": serviceSource,
    "src/users.controller.ts": controllerSource,
    "src/users.module.ts": moduleSource,
    "src/main.ts": entryImportingArtifacts,
  });
  await build(directory, "src/main.ts", [buildPlugin({ cwd: directory })]);

  const invokerPath = join(directory, "src", invokerModuleFileName);
  const generated = await Bun.file(invokerPath).text();
  expect(generated).toContain(`framework: ${JSON.stringify(aponiaVersion)}`);
  // Something other than this build touched the artifact after it was written —
  // an upgrade, a hand edit, a checkout that was never rebuilt.
  const stale = generated.replace(/framework: "[^"]*"/, 'framework: "0.0.0-foreign.1"');
  expect(stale).not.toBe(generated);
  await Bun.write(invokerPath, stale);

  const [decorated, generatedModule, invokerModule] = await Promise.all([
    import(join(directory, "src", "users.module.ts")) as Promise<{ readonly UsersModule: unknown }>,
    import(join(directory, "src", descriptorModuleFileName)) as Promise<{
      readonly moduleDescriptorArtifact: AponiaModuleDescriptorArtifact;
    }>,
    import(invokerPath) as Promise<{ readonly controllerInvokerArtifact: AponiaInvokerArtifact }>,
  ]);
  expect(invokerModule.controllerInvokerArtifact.framework).toBe("0.0.0-foreign.1");

  const logger = new RecordingLogger();
  const refused = await answers(generatedModule.moduleDescriptorArtifact.modules.UsersModule, {
    invokers: invokerModule.controllerInvokerArtifact,
    logger,
  });

  const refusal = logger.records.find((record) => record.context === "RoutesResolver");
  expect(refusal?.message).toContain("0.0.0-foreign.1");
  expect(refusal?.message).toContain(aponiaVersion);
  // The refusal costs a cold start, never an answer.
  expect(refused).toEqual(await answers(decorated.UsersModule));
});

test("a descriptor artifact the build wrote is refused once another release touched it", async () => {
  const directory = await createProject({
    "src/users.service.ts": serviceSource,
    "src/users.controller.ts": controllerSource,
    "src/users.module.ts": moduleSource,
    "src/main.ts": entryImportingArtifacts,
  });
  await build(directory, "src/main.ts", [buildPlugin({ cwd: directory })]);

  const descriptorPath = join(directory, "src", descriptorModuleFileName);
  const generated = await Bun.file(descriptorPath).text();
  expect(generated).toContain(`framework: ${JSON.stringify(aponiaVersion)}`);
  const stale = generated.replace(/framework: "[^"]*"/, 'framework: "0.0.0-foreign.1"');
  expect(stale).not.toBe(generated);
  await Bun.write(descriptorPath, stale);

  const [decorated, generatedModule] = await Promise.all([
    import(join(directory, "src", "users.module.ts")) as Promise<{ readonly UsersModule: unknown }>,
    import(descriptorPath) as Promise<{
      readonly moduleDescriptorArtifact: AponiaModuleDescriptorArtifact;
    }>,
  ]);
  expect(generatedModule.moduleDescriptorArtifact.framework).toBe("0.0.0-foreign.1");

  const logger = new RecordingLogger();
  const refused = await answers(decorated.UsersModule, {
    descriptors: generatedModule.moduleDescriptorArtifact,
    logger,
  });

  const refusal = logger.records.find((record) => record.context === "RoutesResolver");
  expect(refusal?.message).toContain("0.0.0-foreign.1");
  expect(refusal?.message).toContain(aponiaVersion);
  // The whole graph is refused at once, so the answer is the decorated one.
  expect(refused).toEqual(await answers(decorated.UsersModule));
});

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

interface Answer {
  readonly status: number;
  readonly body: string;
}

async function answers(
  rootModule: unknown,
  options: AponiaApplicationOptions = {},
): Promise<readonly Answer[]> {
  const application = await AponiaFactory.create(rootModule as never, {
    ...options,
    logger: options.logger ?? false,
  });

  try {
    const response = await application.handle(new Request("http://localhost/users/7"));
    return [{ status: response.status, body: await response.text() }];
  } finally {
    await application.close();
  }
}

test("names the plugin so a build error can be attributed to it", () => {
  expect(buildPlugin().name).toBe(buildPluginName);
});
