import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  descriptorModuleFileName,
  generateInvokers,
  invokerModuleFileName,
  parseArguments,
  runCli,
} from "../src/index.ts";

const temporaryDirectories: string[] = [];
const initialWorkingDirectory = process.cwd();

afterEach(async () => {
  process.chdir(initialWorkingDirectory);
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

const controllerSource = `import { Body, Controller, Get, Param, Post } from "@aponiajs/common";

@Controller("users")
export class UsersController {
  @Get(":id")
  read(@Param("id") id: string): string {
    return id;
  }

  @Get()
  list(): string {
    return "list";
  }
}
`;

const moduleSource = `import { Module } from "@aponiajs/common";
import { UsersController } from "./users.controller.ts";
import { UsersService } from "./users.service.ts";

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
`;

const serviceSource = `import { Injectable } from "@aponiajs/common";

@Injectable()
export class UsersService {
  read(id: string): string {
    return id;
  }
}
`;

async function createProject(
  options: {
    readonly sourceRoot?: string;
    readonly controllers?: string;
    readonly module?: string;
    readonly service?: string;
  } = {},
): Promise<string> {
  const projectRoot = await createTemporaryDirectory("aponia-build-");
  const sourceRoot = options.sourceRoot ?? "src";
  await mkdir(join(projectRoot, sourceRoot, "users"), { recursive: true });
  await Bun.write(
    join(projectRoot, "aponia.json"),
    `${JSON.stringify({ sourceRoot }, undefined, 2)}\n`,
  );
  await Bun.write(
    join(projectRoot, sourceRoot, "users", "users.controller.ts"),
    options.controllers ?? controllerSource,
  );
  if (options.module !== undefined) {
    await Bun.write(join(projectRoot, sourceRoot, "users", "users.module.ts"), options.module);
    await Bun.write(
      join(projectRoot, sourceRoot, "users", "users.service.ts"),
      options.service ?? serviceSource,
    );
  }
  return projectRoot;
}

test("writes a generated invoker module beside the sources", async () => {
  const projectRoot = await createProject();

  const result = await generateInvokers({ cwd: projectRoot, dryRun: false });

  expect(result.changes).toEqual([{ kind: "CREATE", path: join("src", invokerModuleFileName) }]);

  const generated = await Bun.file(join(projectRoot, "src", invokerModuleFileName)).text();
  expect(generated).toContain('import { UsersController } from "./users/users.controller.ts";');
  expect(generated).toContain('"read"');
  // A handler that declares nothing and reads nothing is generated too, which is
  // the shape a controller is mostly made of.
  expect(generated).toContain('"list"');
});

test("replaces the module on a second run rather than refusing", async () => {
  const projectRoot = await createProject();
  await generateInvokers({ cwd: projectRoot, dryRun: false });

  const result = await generateInvokers({ cwd: projectRoot, dryRun: false });

  expect(result.changes).toEqual([{ kind: "UPDATE", path: join("src", invokerModuleFileName) }]);
});

test("writes nothing on a dry run", async () => {
  const projectRoot = await createProject();

  const result = await generateInvokers({ cwd: projectRoot, dryRun: true });

  expect(result.dryRun).toBe(true);
  expect(await Bun.file(join(projectRoot, "src", invokerModuleFileName)).exists()).toBe(false);
});

test("writes a descriptor module beside the invoker module", async () => {
  const projectRoot = await createProject({ module: moduleSource });

  const result = await generateInvokers({ cwd: projectRoot, dryRun: false });

  expect(result.changes).toEqual([
    { kind: "CREATE", path: join("src", invokerModuleFileName) },
    { kind: "CREATE", path: join("src", descriptorModuleFileName) },
  ]);
  expect(result.declined).toEqual([]);

  const generated = await Bun.file(join(projectRoot, "src", descriptorModuleFileName)).text();
  expect(generated).toContain('import { UsersController } from "./users/users.controller.ts";');
  expect(generated).toContain('  id: "UsersModule",');
  expect(generated).toContain("provideClass(UsersService, [])");
  expect(generated).toContain("UsersModule: UsersModuleDescriptor,");
});

test("replaces the descriptor module on a second run rather than refusing", async () => {
  const projectRoot = await createProject({ module: moduleSource });
  await generateInvokers({ cwd: projectRoot, dryRun: false });

  const result = await generateInvokers({ cwd: projectRoot, dryRun: false });

  expect(result.changes).toEqual([
    { kind: "UPDATE", path: join("src", invokerModuleFileName) },
    { kind: "UPDATE", path: join("src", descriptorModuleFileName) },
  ]);
});

test("writes no descriptor module when the project declares no @Module()", async () => {
  const projectRoot = await createProject();

  const result = await generateInvokers({ cwd: projectRoot, dryRun: false });

  expect(result.changes).toEqual([{ kind: "CREATE", path: join("src", invokerModuleFileName) }]);
  expect(result.declined).toEqual([]);
  expect(await Bun.file(join(projectRoot, "src", descriptorModuleFileName)).exists()).toBe(false);
});

test("does not create a descriptor module when nothing can be declared and none exists", async () => {
  // The boundary beside the empty-record replacement: with no artifact already on
  // disk there is nothing to invalidate, so a build that lowers no module still
  // writes no descriptor rather than creating an empty one out of nothing.
  const projectRoot = await createProject({
    module: `import { Module } from "@aponiajs/common";
import { UsersController } from "./users.controller.ts";

const providers = [];

@Module({ controllers: [UsersController], providers })
export class UsersModule {}
`,
  });

  const result = await generateInvokers({ cwd: projectRoot, dryRun: false });

  expect(result.changes).toEqual([{ kind: "CREATE", path: join("src", invokerModuleFileName) }]);
  expect(await Bun.file(join(projectRoot, "src", descriptorModuleFileName)).exists()).toBe(false);
});

test("replaces a descriptor module with an empty record when a source change makes nothing declarable", async () => {
  const projectRoot = await createProject({
    module: moduleSource,
    // Phase 1: the module is declarable, so a descriptor lands on disk.
  });
  await generateInvokers({ cwd: projectRoot, dryRun: false });
  expect(await Bun.file(join(projectRoot, "src", descriptorModuleFileName)).text()).toContain(
    "UsersModule: UsersModuleDescriptor,",
  );

  // Phase 2: an `imports` entry that is not an array literal makes the only
  // module undeclarable, so the emitter lowers nothing.
  await Bun.write(
    join(projectRoot, "src", "users", "users.module.ts"),
    `import { Module } from "@aponiajs/common";
import { UsersController } from "./users.controller.ts";
import { UsersService } from "./users.service.ts";

const widgets = [];

@Module({ imports: widgets, controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
`,
  );

  const result = await generateInvokers({ cwd: projectRoot, dryRun: false });

  // The stale graph does not survive: the file is rewritten as an empty record so
  // the platform refuses it and lowers the decorated root instead.
  expect(result.changes).toEqual([
    { kind: "UPDATE", path: join("src", invokerModuleFileName) },
    { kind: "UPDATE", path: join("src", descriptorModuleFileName) },
  ]);
  const generated = await Bun.file(join(projectRoot, "src", descriptorModuleFileName)).text();
  expect(generated).toContain("export const moduleDescriptorArtifact = Object.freeze({");
  expect(generated).toContain("framework:");
  expect(generated).toContain("modules: Object.freeze({");
  expect(generated).not.toContain("UsersModule");
});

test("reports a declined module and still writes the invoker module", async () => {
  const projectRoot = await createProject({
    controllers: controllerSource,
    module: `import { Module } from "@aponiajs/common";
import { UsersController } from "./users.controller.ts";
import { UsersService } from "./users.service.ts";

const providers = [UsersService];

@Module({ controllers: [UsersController], providers })
export class UsersModule {}
`,
  });

  const result = await generateInvokers({ cwd: projectRoot, dryRun: false });

  expect(result.changes).toEqual([{ kind: "CREATE", path: join("src", invokerModuleFileName) }]);
  expect(result.declined).toEqual([
    {
      kind: "module",
      module: "UsersModule",
      reason:
        "@Module in " +
        join(projectRoot, "src", "users", "users.module.ts") +
        ' declares "providers" outside its options literal.',
    },
  ]);
  expect(await Bun.file(join(projectRoot, "src", invokerModuleFileName)).exists()).toBe(true);
  expect(await Bun.file(join(projectRoot, "src", descriptorModuleFileName)).exists()).toBe(false);
});

test("honours the configured source root", async () => {
  const projectRoot = await createProject({ sourceRoot: "app" });

  const result = await generateInvokers({ cwd: projectRoot, dryRun: false });

  expect(result.changes).toEqual([{ kind: "CREATE", path: join("app", invokerModuleFileName) }]);
  expect(await Bun.file(join(projectRoot, "app", invokerModuleFileName)).exists()).toBe(true);
});

test("reports the source root when the project holds no controller", async () => {
  const projectRoot = await createProject({ sourceRoot: "app" });
  await rm(join(projectRoot, "app", "users"), { recursive: true, force: true });

  const error = await generateInvokers({ cwd: projectRoot, dryRun: false }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect((error as Error).message).toContain('under "app"');
});

test("refuses two controllers that share a class name", async () => {
  const projectRoot = await createProject();
  await mkdir(join(projectRoot, "src", "admin"), { recursive: true });
  await Bun.write(join(projectRoot, "src", "admin", "users.controller.ts"), controllerSource);

  const error = await generateInvokers({ cwd: projectRoot, dryRun: false }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect((error as Error).message).toContain('Two controllers are named "UsersController"');
});

test("rejects an unexpected positional argument to build", () => {
  expect(() => parseArguments(["build", "extra"])).toThrow('Unexpected argument "extra".');
});

test("reports the change and the next step through runCli", async () => {
  const projectRoot = await createProject();
  process.chdir(projectRoot);
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    output.push(String(message));
  });

  try {
    expect(await runCli(["build"])).toBe(0);
  } finally {
    log.mockRestore();
  }

  expect(output).toEqual([
    `CREATE ${join("src", invokerModuleFileName)}`,
    "Next: import it in your entrypoint and pass its controllerInvokers to AponiaFactory.create.",
  ]);
});

test("reports both generated modules and a decline through runCli", async () => {
  const projectRoot = await createProject({
    module: `import { Module } from "@aponiajs/common";
import { UsersController } from "./users.controller.ts";

const providers = [];

@Module({ controllers: [UsersController], providers })
export class UsersModule {}
`,
  });
  process.chdir(projectRoot);
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    output.push(String(message));
  });

  try {
    expect(await runCli(["build"])).toBe(0);
  } finally {
    log.mockRestore();
  }

  expect(output).toHaveLength(3);
  expect(output[0]).toBe(`CREATE ${join("src", invokerModuleFileName)}`);
  expect(output[1]).toBe(
    `DECLINED module UsersModule: @Module in ${join(await realpath(projectRoot), "src", "users", "users.module.ts")} declares "providers" outside its options literal.`,
  );
  expect(output[2]).toBe(
    "Next: import it in your entrypoint and pass its controllerInvokers to AponiaFactory.create.",
  );
});

test("fails outside an Aponia project without throwing", async () => {
  const projectRoot = await createTemporaryDirectory("aponia-build-empty-");
  process.chdir(projectRoot);
  const errors: string[] = [];
  const error = spyOn(console, "error").mockImplementation((message) => {
    errors.push(String(message));
  });

  try {
    expect(await runCli(["build"])).toBe(1);
  } finally {
    error.mockRestore();
  }

  expect(errors[0]).toContain("aponia.json");
});

test("fails with the first decline when no handler could be generated", async () => {
  const projectRoot = await createProject({
    controllers: `import { Controller, Context, Get } from "@aponiajs/common";

@Controller("whole")
export class WholeController {
  @Get()
  read(@Context() context: unknown): unknown {
    return context;
  }
}
`,
  });

  const error = await generateInvokers({ cwd: projectRoot, dryRun: false }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect((error as Error).message).toContain("WholeController.read");
  expect(await Bun.file(join(projectRoot, "src", invokerModuleFileName)).exists()).toBe(false);
});
