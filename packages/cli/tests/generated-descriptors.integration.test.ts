import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { AponiaFactory, inspectAponiaApplication } from "@aponiajs/platform-elysia";
import {
  analyzeControllerRoutes,
  analyzeModuleDescriptors,
  collectSourceImports,
  emitModuleDescriptors,
} from "../src/index.ts";
import type { DescriptorSourceFile } from "../src/index.ts";

/**
 * The acceptance criterion for build-time module descriptors: an application
 * booted from the generated descriptor module answers exactly as one booted from
 * its decorated classes.
 *
 * The emitter lives in `@aponiajs/cli` and the descriptor authoring surface it
 * emits calls lives in `@aponiajs/platform-elysia`, so this is the only place the
 * two halves meet. It is why this package carries the platform as a development
 * dependency; the CLI's own source still imports nothing from it.
 *
 * The fixture is deliberately more than one module: `UsersModule` imports
 * `AuditModule` and its controller injects a provider `AuditModule` exports, so
 * booting the generated module proves the emitted `imports`, `exports`, and
 * `inject` lists all wire the same container the decorators do.
 */
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const sources: Readonly<Record<string, string>> = {
  "audit.service.ts": `import { Injectable } from "@aponiajs/common";

@Injectable()
export class AuditService {
  record(): string {
    return "audited";
  }
}
`,
  "audit.module.ts": `import { Module } from "@aponiajs/common";
import { AuditService } from "./audit.service.ts";

@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
`,
  "users.service.ts": `import { Injectable } from "@aponiajs/common";

@Injectable()
export class UsersService {
  read(id: string): string {
    return \`read:\${id}\`;
  }

  create(name: string): string {
    return \`created:\${name}\`;
  }

  update(id: string): string {
    return \`updated:\${id}\`;
  }
}
`,
  // The shape the CLI's own REST resource schematic emits: the validators are
  // module-private constants, and one of them is built from another.
  "users.model.ts": `import { Validation } from "@aponiajs/common";
import { t } from "elysia";

const createUserSchema = t.Object({ name: t.String({ minLength: 2 }) });
const updateUserSchema = t.Partial(createUserSchema);

@Validation(createUserSchema)
export class CreateUser {}
export interface CreateUser {
  readonly name: string;
}

@Validation(updateUserSchema)
export class UpdateUser {}
export interface UpdateUser {
  readonly name?: string;
}
`,
  "users.controller.ts": `import { Body, Controller, Get, Param, Patch, Post } from "@aponiajs/common";
import { AuditService } from "./audit.service.ts";
import { CreateUser, UpdateUser } from "./users.model.ts";
import { UsersService } from "./users.service.ts";

@Controller("users")
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  @Get(":id")
  read(@Param("id") id: string): string {
    return \`\${this.usersService.read(id)}:\${this.auditService.record()}\`;
  }

  @Post("/", { body: CreateUser })
  create(@Body() body: CreateUser): string {
    return this.usersService.create(body.name);
  }

  @Patch(":id", { body: UpdateUser })
  update(@Param("id") id: string): string {
    return this.usersService.update(id);
  }
}
`,
  "users.module.ts": `import { Module } from "@aponiajs/common";
import { AuditModule } from "./audit.module.ts";
import { UsersController } from "./users.controller.ts";
import { UsersService } from "./users.service.ts";

@Module({
  imports: [AuditModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
`,
  "events.gateway.ts": `import { MessageBody, SubscribeMessage, WebSocketGateway } from "@aponiajs/common";

@WebSocketGateway("/events")
export class EventsGateway {
  @SubscribeMessage("events.echo")
  echo(@MessageBody("value") value: string): { readonly value: string } {
    return { value };
  }

  @SubscribeMessage("events.silent")
  silent(): undefined {
    return undefined;
  }
}
`,
  "events.module.ts": `import { Module } from "@aponiajs/common";
import { EventsGateway } from "./events.gateway.ts";

@Module({ providers: [EventsGateway], exports: [EventsGateway] })
export class EventsModule {}
`,
};

interface Fixture {
  readonly UsersModule: unknown;
  readonly EventsModule: unknown;
  readonly source: string;
  readonly moduleDescriptors: Readonly<Record<string, unknown>>;
}

/**
 * Writes the fixture and the module a build would generate beside it.
 *
 * The generated module imports the fixture, and the application imports the same
 * files, so the pair is written somewhere module resolution can reach the
 * workspace from.
 */
async function generateFixture(): Promise<Fixture> {
  const directory = await mkdtemp(
    join(import.meta.dir, "..", "node_modules", ".aponia-descriptors-"),
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
  const emitted = emitModuleDescriptors(files, generatedPath);
  if (emitted.source === undefined) {
    throw new Error(`The emitter declined every module: ${JSON.stringify(emitted.declined)}`);
  }
  if (emitted.declined.length > 0) {
    throw new Error(`The emitter declined a declaration: ${JSON.stringify(emitted.declined)}`);
  }
  await Bun.write(generatedPath, emitted.source);

  const [module, events, generated] = await Promise.all([
    import(join(directory, "users.module.ts")) as Promise<Fixture>,
    import(join(directory, "events.module.ts")) as Promise<Fixture>,
    import(generatedPath) as Promise<Fixture>,
  ]);

  return {
    UsersModule: module.UsersModule,
    EventsModule: events.EventsModule,
    source: emitted.source,
    moduleDescriptors: generated.moduleDescriptors,
  };
}

interface Answer {
  readonly status: number;
  readonly body: string;
}

async function answers(rootModule: unknown): Promise<readonly Answer[]> {
  const application = await AponiaFactory.create(rootModule as never, { logger: false });

  try {
    return await Promise.all(
      [
        new Request("http://localhost/users/7"),
        new Request("http://localhost/users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "aponia" }),
        }),
        new Request("http://localhost/users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "x" }),
        }),
        // `UpdateUser` is `t.Partial(createUserSchema)`, so the same minimum
        // length applies and an empty body is still accepted — which is what
        // proves the folded constant is the validator the model declared.
        new Request("http://localhost/users/7", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "z" }),
        }),
        new Request("http://localhost/users/7", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
      ].map(async (request) => {
        const response = await application.handle(request);
        return { status: response.status, body: await response.text() };
      }),
    );
  } finally {
    await application.close();
  }
}

test("a generated descriptor module answers exactly as the decorated application", async () => {
  const fixture = await generateFixture();

  const compiled = await answers(fixture.UsersModule);
  const generated = await answers(fixture.moduleDescriptors.UsersModule);

  expect(generated).toEqual(compiled);
  expect(compiled.map((answer) => answer.status)).toEqual([200, 200, 422, 422, 200]);
  // The first body carries the audit provider, which only resolves when the
  // generated module's `imports` and `exports` reach the other module.
  expect(compiled[0]?.body).toBe("read:7:audited");
  // The second body comes from the controller's own injected service, and the
  // third and fourth are the platform refusing a body the `@Validation()` model
  // rejects.
  expect(compiled[1]?.body).toBe("created:aponia");
  expect(compiled[4]?.body).toBe("updated:7");
});

test("a generated schema slot states the model's validator instead of naming the model", async () => {
  const fixture = await generateFixture();

  // The model's own constants are folded into the expression, because a
  // generated module cannot name a binding the model file does not export.
  expect(fixture.source).toContain("body: t.Object({ name: t.String({ minLength: 2 }) })");
  expect(fixture.source).toContain(
    "body: t.Partial(t.Object({ name: t.String({ minLength: 2 }) }))",
  );
  expect(fixture.source).toContain('import { t } from "elysia";');
  // Nothing names a model class, which is what takes the runtime's
  // `@Validation()` metadata read off the startup path.
  expect(fixture.source).not.toContain("CreateUser");
  expect(fixture.source).not.toContain("UpdateUser");
});

test("a generated descriptor module declares every module of the graph", async () => {
  const fixture = await generateFixture();

  expect(Object.keys(fixture.moduleDescriptors).toSorted()).toEqual([
    "AuditModule",
    "EventsModule",
    "UsersModule",
  ]);
});

test("a generated gateway is discovered with the same path and events as the decorated one", async () => {
  const fixture = await generateFixture();

  expect(fixture.source).toContain("defineElysiaWebSocketGateway(EventsGateway, {");
  expect(fixture.source).toContain(
    ['          event: "events.echo",', '          propertyKey: "echo",'].join("\n"),
  );
  expect(fixture.source).toContain('{ index: 0, kind: "message-body", property: "value" }');
  // A handler that binds no parameter declares none, which is what it receives.
  expect(fixture.source).toContain(
    ['          event: "events.silent",', '          propertyKey: "silent",'].join("\n"),
  );

  // Inspection runs bootstrap's own lowering, so equal projections mean the
  // declared gateway reaches the same compilation a decorated one does.
  const compiled = inspectAponiaApplication(fixture.EventsModule as never);
  const generated = inspectAponiaApplication(fixture.moduleDescriptors.EventsModule as never);

  expect(generated.gateways).toEqual(compiled.gateways);
  expect(compiled.gateways).toEqual([
    {
      module: "EventsModule",
      token: "EventsGateway",
      path: "/events",
      events: ["events.echo", "events.silent"],
    },
  ]);
});
