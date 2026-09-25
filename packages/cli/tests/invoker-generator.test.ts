import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateInvokers, invokerModuleFileName, parseArguments, runCli } from "../src/index.ts";

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

async function createProject(
  options: { readonly sourceRoot?: string; readonly controllers?: string } = {},
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
    controllers: `import { Controller, Ctx, Get } from "@aponiajs/common";

@Controller("whole")
export class WholeController {
  @Get()
  read(@Ctx() context: unknown): unknown {
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
