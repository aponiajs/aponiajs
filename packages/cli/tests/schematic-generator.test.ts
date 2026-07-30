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

test.each([
  [["generate"], "Schematic name is required."],
  [["generate", "unknown", "sample"], 'Unknown schematic "unknown". Available schematics:'],
  [["generate", "service"], "Service name is required."],
  [["generate", "service", "users", "extra"], 'Unexpected argument "extra".'],
  [["generate", "resource", "users", "--type", "smtp"], 'Unknown resource transport "smtp".'],
] as const)("rejects invalid generate command arguments", (arguments_, message) => {
  expect(() => parseArguments(arguments_)).toThrow(message);
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

test("generates a provider-registered WebSocket gateway", async () => {
  const projectRoot = await createProjectRoot("aponia-websocket-gateway-");
  await generateSchematic({
    command: "generate",
    schematic: "gateway",
    name: "events",
    dryRun: false,
    skipImport: false,
    crud: true,
    type: "ws",
    cwd: projectRoot,
  });

  const gateway = await Bun.file(join(projectRoot, "src/events.gateway.ts")).text();
  const gatewaySpec = await Bun.file(join(projectRoot, "src/events.gateway.spec.ts")).text();
  const module = await Bun.file(join(projectRoot, "src/app.module.ts")).text();

  expect(gateway).toBe(
    'import { WebSocketGateway } from "@aponiajs/common";\n\n@WebSocketGateway("/events")\nexport class EventsGateway {}\n',
  );
  expect(gatewaySpec).toContain('import { getWebSocketGatewayMetadata } from "@aponiajs/common";');
  expect(gatewaySpec).toContain(
    'expect(getWebSocketGatewayMetadata(EventsGateway)?.path).toBe("/events");',
  );
  expect(module).toContain('import { EventsGateway } from "./events.gateway.ts";');
  expect(module).toContain("providers: [EventsGateway]");
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
      "src/users/users.model.ts",
      "src/users/entities/user.entity.ts",
      "src/app.module.ts",
    ]),
  );
  expect(result.changes.map((change) => change.path)).not.toEqual(
    expect.arrayContaining([
      "src/users/dto/create-user.dto.ts",
      "src/users/dto/update-user.dto.ts",
    ]),
  );
  expect(await Bun.file(join(projectRoot, "src/users/dto")).exists()).toBe(false);
  expect(await Bun.file(join(projectRoot, "src/app.module.ts")).text()).toContain(
    "imports: [UsersModule],",
  );
  expect(result.changes.map((change) => change.path)).not.toContain("src/users/users.schema.ts");
  expect(await Bun.file(join(projectRoot, "src/users/users.schema.ts")).exists()).toBe(false);
});

test("REST CRUD resource uses separate validation model classes without DTO files", async () => {
  const projectRoot = await createProjectRoot("aponia-resource-model-");
  await generateSchematic({
    command: "generate",
    schematic: "resource",
    name: "users",
    dryRun: false,
    skipImport: false,
    crud: true,
    type: "rest",
    cwd: projectRoot,
  });

  const model = await Bun.file(join(projectRoot, "src/users/users.model.ts")).text();
  expect(model).toContain(
    'import { Validation, type InferValidatorOutput } from "@aponiajs/common";',
  );
  expect(model).toContain('import { t } from "elysia";');
  expect(model).toContain(
    "Validation models are metadata tokens for Elysia-validated plain objects",
  );
  expect(model).toContain("const createUserSchema = t.Object({");
  expect(model).toContain("@Validation(createUserSchema)");
  expect(model).toContain("export class CreateUser {}");
  expect(model).toContain(
    "export interface CreateUser extends InferValidatorOutput<typeof createUserSchema> {}",
  );
  expect(model).toContain("const updateUserSchema = t.Partial(createUserSchema);");
  expect(model).toContain("@Validation(updateUserSchema)");
  expect(model).toContain("export class UpdateUser {}");
  expect(model).toContain(
    "export interface UpdateUser extends InferValidatorOutput<typeof updateUserSchema> {}",
  );
  expect(model).toContain("const userParamsSchema = t.Object({");
  expect(model).toContain("@Validation(userParamsSchema)");
  expect(model).toContain("export class UserParams {}");
  expect(model).toContain(
    "export interface UserParams extends InferValidatorOutput<typeof userParamsSchema> {}",
  );
  expect(model).not.toContain("export const");
  expect(model).not.toContain("Route =");
  expect(model).not.toContain("Static<");

  const controller = await Bun.file(join(projectRoot, "src/users/users.controller.ts")).text();
  expect(controller).toContain(
    'import { Body, Controller, Delete, Get, Param, Patch, Post } from "@aponiajs/common";',
  );
  expect(controller).toContain(
    'import { CreateUser, UpdateUser, UserParams } from "./users.model.ts";',
  );
  expect(controller).toContain('@Post("/", { body: CreateUser })');
  expect(controller).toContain("create(@Body() input: CreateUser)");
  expect(controller).toContain('@Get(":id", { params: UserParams })');
  expect(controller).toContain("findOne(@Param() params: UserParams)");
  expect(controller).toContain('@Patch(":id", { params: UserParams, body: UpdateUser })');
  expect(controller).toContain("update(@Param() params: UserParams, @Body() input: UpdateUser)");
  expect(controller).toContain('@Delete(":id", { params: UserParams })');
  expect(controller).toContain("remove(@Param() params: UserParams)");
  expect(controller).not.toContain("Route");
  expect(controller).not.toContain("Dto");

  const service = await Bun.file(join(projectRoot, "src/users/users.service.ts")).text();
  expect(service).toContain('import type { CreateUser, UpdateUser } from "./users.model.ts";');
  expect(service).toContain("create(input: CreateUser): User");
  expect(service).toContain("const item = { id: crypto.randomUUID(), name: input.name };");
  expect(service).toContain("update(id: string, input: UpdateUser): User | undefined");
  expect(service).not.toContain("./dto/");

  expect(await Bun.file(join(projectRoot, "src/users/dto/create-user.dto.ts")).exists()).toBe(
    false,
  );
  expect(await Bun.file(join(projectRoot, "src/users/dto/update-user.dto.ts")).exists()).toBe(
    false,
  );

  expect(await Bun.file(join(projectRoot, "src/users/users.schema.ts")).exists()).toBe(false);
});

test("REST model preserves camel-case schema identifiers for compound resources", async () => {
  const projectRoot = await createProjectRoot("aponia-compound-resource-model-");
  await generateSchematic({
    command: "generate",
    schematic: "resource",
    name: "blog-posts",
    dryRun: false,
    skipImport: false,
    crud: true,
    type: "rest",
    cwd: projectRoot,
  });

  const model = await Bun.file(join(projectRoot, "src/blog-posts/blog-posts.model.ts")).text();
  expect(model).toContain("const blogPostParamsSchema = t.Object({");
  expect(model).toContain("@Validation(blogPostParamsSchema)");
  expect(model).toContain(
    "export interface BlogPostParams extends InferValidatorOutput<typeof blogPostParamsSchema> {}",
  );
  expect(model).not.toContain("blogpostParamsSchema");
});

test("resource keeps plain DTO classes for non-REST transports", async () => {
  const projectRoot = await createProjectRoot("aponia-resource-ws-");
  await generateSchematic({
    command: "generate",
    schematic: "resource",
    name: "users",
    dryRun: false,
    skipImport: false,
    crud: true,
    type: "ws",
    cwd: projectRoot,
  });

  expect(await Bun.file(join(projectRoot, "src/users/users.model.ts")).exists()).toBe(false);
  expect(await Bun.file(join(projectRoot, "src/users/dto/create-user.dto.ts")).text()).toContain(
    "export class CreateUserDto",
  );
  expect(await Bun.file(join(projectRoot, "src/users/dto/update-user.dto.ts")).text()).toContain(
    "export type UpdateUserDto = Partial<CreateUserDto>",
  );
  expect(await Bun.file(join(projectRoot, "src/users/users.service.ts")).text()).toContain(
    'import type { CreateUserDto } from "./dto/create-user.dto.ts";',
  );

  const gateway = await Bun.file(join(projectRoot, "src/users/users.gateway.ts")).text();
  const gatewaySpec = await Bun.file(join(projectRoot, "src/users/users.gateway.spec.ts")).text();
  const module = await Bun.file(join(projectRoot, "src/users/users.module.ts")).text();

  expect(gateway).toContain(
    'import { MessageBody, SubscribeMessage, WebSocketGateway } from "@aponiajs/common";',
  );
  expect(gateway).toContain('@WebSocketGateway("/users")');
  expect(gateway).toContain('@SubscribeMessage("users.create")');
  expect(gateway).toContain("create(@MessageBody() input: CreateUserDto)");
  expect(gateway).toContain('@SubscribeMessage("users.findAll")');
  expect(gateway).toContain('@SubscribeMessage("users.findOne")');
  expect(gateway).toContain('findOne(@MessageBody("id") id: string)');
  expect(gateway).toContain('@SubscribeMessage("users.update")');
  expect(gateway).toContain(
    'update(@MessageBody("id") id: string, @MessageBody("input") input: UpdateUserDto)',
  );
  expect(gateway).toContain('@MessageBody("input") input: UpdateUserDto');
  expect(gateway).toContain('@SubscribeMessage("users.remove")');
  expect(gatewaySpec).toContain(
    'expect(getWebSocketGatewayMetadata(UsersGateway)?.path).toBe("/users");',
  );
  expect(gatewaySpec).toContain('"users.findAll"');
  expect(module).toContain("providers: [UsersGateway, UsersService]");
});

test("REST resource without CRUD does not generate or import a model", async () => {
  const projectRoot = await createProjectRoot("aponia-resource-no-crud-");
  const result = await generateSchematic({
    command: "generate",
    schematic: "resource",
    name: "events",
    dryRun: false,
    skipImport: false,
    crud: false,
    type: "rest",
    cwd: projectRoot,
  });

  expect(result.changes.map((change) => change.path)).not.toContain("src/events/events.model.ts");
  expect(await Bun.file(join(projectRoot, "src/events/events.model.ts")).exists()).toBe(false);
  expect(await Bun.file(join(projectRoot, "src/events/dto")).exists()).toBe(false);
  expect(await Bun.file(join(projectRoot, "src/events/events.controller.ts")).text()).not.toContain(
    ".model.ts",
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
  expect(await Bun.file(join(noCrudRoot, "src/events/events.gateway.ts")).text()).toContain(
    '@WebSocketGateway("/events")',
  );
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

test("refuses to overwrite an existing schematic file", async () => {
  const projectRoot = await createProjectRoot("aponia-existing-schematic-");
  const existingFile = join(projectRoot, "src/reports/reports.service.ts");
  await mkdir(join(projectRoot, "src/reports"), { recursive: true });
  await Bun.write(existingFile, "user content\n");

  expect(
    generateSchematic({
      command: "generate",
      schematic: "service",
      name: "reports",
      dryRun: false,
      skipImport: false,
      crud: true,
      type: "rest",
      cwd: projectRoot,
    }),
  ).rejects.toThrow('File "src/reports/reports.service.ts" already exists.');
  expect(await Bun.file(existingFile).text()).toBe("user content\n");
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
