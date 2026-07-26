import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateSchematic,
  generateSchematics,
  parseArguments,
  type GenerateSchematic,
} from "../src/index.ts";
import { aponiaVersion } from "../src/version.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

const expectedPrimaryFiles: Readonly<
  Record<Exclude<GenerateSchematic, "app" | "library">, string>
> = {
  class: "src/sample.ts",
  controller: "src/sample/sample.controller.ts",
  decorator: "src/sample.decorator.ts",
  filter: "src/sample.filter.ts",
  gateway: "src/sample.gateway.ts",
  guard: "src/sample.guard.ts",
  interface: "src/sample.interface.ts",
  interceptor: "src/sample.interceptor.ts",
  middleware: "src/sample.middleware.ts",
  module: "src/sample/sample.module.ts",
  pipe: "src/sample.pipe.ts",
  provider: "src/sample.ts",
  resolver: "src/sample/sample.resolver.ts",
  resource: "src/sample/sample.module.ts",
  service: "src/sample/sample.service.ts",
};

test("supports the complete Nest generate schematic catalog and aliases", () => {
  expect(generateSchematics).toEqual([
    "app",
    "library",
    "class",
    "controller",
    "decorator",
    "filter",
    "gateway",
    "guard",
    "interface",
    "interceptor",
    "middleware",
    "module",
    "pipe",
    "provider",
    "resolver",
    "resource",
    "service",
  ]);

  expect(parseArguments(["g", "co", "users", "--no-spec", "--flat"])).toMatchObject({
    command: "generate",
    schematic: "controller",
    name: "users",
    spec: false,
    flat: true,
  });
  expect(parseArguments(["generate", "router", "health"])).toMatchObject({
    command: "generate",
    schematic: "controller",
    name: "health",
  });
  expect(parseArguments(["g", "res", "users", "--type", "ws", "--no-crud"])).toMatchObject({
    command: "generate",
    schematic: "resource",
    type: "ws",
    crud: false,
  });
});

test("generates every component and resource schematic", async () => {
  for (const schematic of generateSchematics) {
    if (schematic === "app" || schematic === "library") continue;

    const projectRoot = await createProjectRoot(`aponia-${schematic}-`);
    const result = await generateSchematic({
      command: "generate",
      schematic,
      name: "sample",
      dryRun: false,
      skipImport: false,
      crud: true,
      type: "rest",
      cwd: projectRoot,
    });

    const expectedFile = expectedPrimaryFiles[schematic];
    expect(result.changes.map((change) => change.path)).toContain(expectedFile);
    expect(await Bun.file(join(projectRoot, expectedFile)).exists()).toBe(true);
  }
});

test("generates application and library workspaces with synchronized dependencies", async () => {
  const projectRoot = await createProjectRoot("aponia-workspace-schematics-");

  await generateSchematic({
    command: "generate",
    schematic: "app",
    name: "admin-api",
    dryRun: false,
    skipImport: false,
    crud: true,
    type: "rest",
    cwd: projectRoot,
  });
  await generateSchematic({
    command: "generate",
    schematic: "library",
    name: "shared-utils",
    dryRun: false,
    skipImport: false,
    crud: true,
    type: "rest",
    cwd: projectRoot,
  });

  const applicationManifest = (await Bun.file(
    join(projectRoot, "apps/admin-api/package.json"),
  ).json()) as {
    readonly dependencies: Readonly<Record<string, string>>;
  };
  const libraryManifest = (await Bun.file(
    join(projectRoot, "packages/shared-utils/package.json"),
  ).json()) as {
    readonly dependencies: Readonly<Record<string, string>>;
  };

  expect(applicationManifest.dependencies["@aponiajs/common"]).toBe(aponiaVersion);
  expect(applicationManifest.dependencies["@aponiajs/platform-elysia"]).toBe(aponiaVersion);
  expect(libraryManifest.dependencies["@aponiajs/common"]).toBe(aponiaVersion);
});

test("registers controllers, providers, and feature modules in the nearest module", async () => {
  const projectRoot = await createProjectRoot("aponia-registration-");

  await generateSchematic({
    command: "generate",
    schematic: "controller",
    name: "users",
    dryRun: false,
    skipImport: false,
    crud: true,
    type: "rest",
    cwd: projectRoot,
  });
  await generateSchematic({
    command: "generate",
    schematic: "service",
    name: "users",
    dryRun: false,
    skipImport: false,
    crud: true,
    type: "rest",
    cwd: projectRoot,
  });
  await generateSchematic({
    command: "generate",
    schematic: "module",
    name: "billing",
    dryRun: false,
    skipImport: false,
    crud: true,
    type: "rest",
    cwd: projectRoot,
  });

  const moduleSource = await Bun.file(join(projectRoot, "src/app.module.ts")).text();
  expect(moduleSource).toContain('import { UsersController } from "./users/users.controller.ts";');
  expect(moduleSource).toContain('import { UsersService } from "./users/users.service.ts";');
  expect(moduleSource).toContain('import { BillingModule } from "./billing/billing.module.ts";');
  expect(moduleSource).toContain("controllers: [UsersController]");
  expect(moduleSource).toContain("providers: [UsersService]");
  expect(moduleSource).toContain("imports: [BillingModule]");
});

test("resource generates CRUD building blocks and registers its module", async () => {
  const projectRoot = await createProjectRoot("aponia-resource-");
  const result = await generateSchematic({
    command: "generate",
    schematic: "resource",
    name: "users",
    dryRun: false,
    skipImport: false,
    crud: true,
    type: "rest",
    cwd: projectRoot,
  });

  expect(result.changes.map((change) => change.path)).toEqual(
    expect.arrayContaining([
      "src/users/users.module.ts",
      "src/users/users.controller.ts",
      "src/users/users.controller.spec.ts",
      "src/users/users.service.ts",
      "src/users/users.service.spec.ts",
      "src/users/dto/create-user.dto.ts",
      "src/users/dto/update-user.dto.ts",
      "src/users/entities/user.entity.ts",
      "src/app.module.ts",
    ]),
  );
  expect(await Bun.file(join(projectRoot, "src/app.module.ts")).text()).toContain(
    "imports: [UsersModule]",
  );
});

test("resource honors transport and CRUD choices", async () => {
  const graphqlRoot = await createProjectRoot("aponia-graphql-resource-");
  await generateSchematic({
    command: "generate",
    schematic: "resource",
    name: "users",
    dryRun: false,
    skipImport: false,
    crud: true,
    type: "graphql-code-first",
    cwd: graphqlRoot,
  });

  expect(await Bun.file(join(graphqlRoot, "src/users/users.resolver.ts")).exists()).toBe(true);
  expect(await Bun.file(join(graphqlRoot, "src/users/dto/create-user.input.ts")).text()).toContain(
    "CreateUserInput",
  );
  expect(await Bun.file(join(graphqlRoot, "src/users/users.service.ts")).text()).toContain(
    "CreateUserInput",
  );

  const noCrudRoot = await createProjectRoot("aponia-no-crud-resource-");
  await generateSchematic({
    command: "generate",
    schematic: "resource",
    name: "events",
    dryRun: false,
    skipImport: false,
    crud: false,
    type: "ws",
    cwd: noCrudRoot,
  });

  expect(await Bun.file(join(noCrudRoot, "src/events/events.gateway.ts")).exists()).toBe(true);
  expect(await Bun.file(join(noCrudRoot, "src/events/dto")).exists()).toBe(false);
  expect(await Bun.file(join(noCrudRoot, "src/events/entities")).exists()).toBe(false);
  expect(await Bun.file(join(noCrudRoot, "src/events/events.service.ts")).text()).not.toContain(
    "findAll",
  );
});

test("project generate options override global defaults and CLI flags override both", async () => {
  const projectRoot = await createProjectRoot("aponia-generate-options-");
  await Bun.write(
    join(projectRoot, "aponia.json"),
    `${JSON.stringify(
      {
        generateOptions: { flat: true, spec: false },
        projects: {
          api: {
            sourceRoot: "apps/api/src",
            generateOptions: { flat: false, spec: { service: true } },
          },
        },
      },
      undefined,
      2,
    )}\n`,
  );
  await mkdir(join(projectRoot, "apps/api/src"), { recursive: true });
  await Bun.write(
    join(projectRoot, "apps/api/src/app.module.ts"),
    'import { Module } from "@aponiajs/common";\n\n@Module({})\nexport class AppModule {}\n',
  );

  await generateSchematic({
    command: "generate",
    schematic: "service",
    name: "users",
    dryRun: false,
    skipImport: false,
    project: "api",
    crud: true,
    type: "rest",
    cwd: projectRoot,
  });
  expect(
    await Bun.file(join(projectRoot, "apps/api/src/users/users.service.spec.ts")).exists(),
  ).toBe(true);

  await generateSchematic({
    command: "generate",
    schematic: "controller",
    name: "health",
    dryRun: false,
    flat: true,
    spec: true,
    skipImport: false,
    project: "api",
    crud: true,
    type: "rest",
    cwd: projectRoot,
  });
  expect(await Bun.file(join(projectRoot, "apps/api/src/health.controller.spec.ts")).exists()).toBe(
    true,
  );
});

test("dry-run reports changes without modifying files", async () => {
  const projectRoot = await createProjectRoot("aponia-schematic-dry-");
  const before = await Bun.file(join(projectRoot, "src/app.module.ts")).text();
  const result = await generateSchematic({
    command: "generate",
    schematic: "service",
    name: "reports",
    dryRun: true,
    skipImport: false,
    crud: true,
    type: "rest",
    cwd: projectRoot,
  });

  expect(result.dryRun).toBe(true);
  expect(result.changes.map((change) => change.path)).toContain("src/reports/reports.service.ts");
  expect(await Bun.file(join(projectRoot, "src/reports/reports.service.ts")).exists()).toBe(false);
  expect(await Bun.file(join(projectRoot, "src/app.module.ts")).text()).toBe(before);
});

async function createProjectRoot(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(projectRoot);
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await Bun.write(
    join(projectRoot, "aponia.json"),
    `${JSON.stringify({ sourceRoot: "src", generateOptions: { spec: true } }, undefined, 2)}\n`,
  );
  await Bun.write(
    join(projectRoot, "src/app.module.ts"),
    'import { Module } from "@aponiajs/common";\n\n@Module({})\nexport class AppModule {}\n',
  );
  return projectRoot;
}
