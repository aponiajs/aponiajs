import { expect, test } from "bun:test";
import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  defineModule,
  provideClass,
  type LoggerService,
} from "@aponiajs/common";
import { t } from "elysia";
import {
  AponiaFactory,
  defineElysiaControllerRoutes,
  type AponiaApplicationOptions,
  type AponiaModuleDescriptorArtifact,
} from "../src/index.ts";

/**
 * The descriptor artifact is the whole module graph rather than one handler, so
 * these cases assert the two properties that make the option safe to adopt: the
 * graph it names serves exactly what the decorated module serves, and everything
 * else — another release, no entry for the root, a malformed entry, no record at
 * all — is refused whole in favour of the module the application named.
 */

/**
 * The version the running platform reports, read from the manifest it ships
 * rather than imported from the module under test, so a case that has to be
 * refused cannot accidentally agree with a broken implementation.
 */
const frameworkVersion = (
  (await Bun.file(new URL("../package.json", import.meta.url)).json()) as { version: string }
).version;

const createItemSchema = {
  body: t.Object({ name: t.String({ minLength: 2 }) }),
};

@Injectable()
class DescriptorUsersService {
  read(id: string): string {
    return `read:${id}`;
  }
}

@Controller("users")
class DescriptorUsersController {
  constructor(private readonly usersService: DescriptorUsersService) {}

  @Get(":id")
  read(@Param("id") id: string): string {
    return this.usersService.read(id);
  }

  @Post("items", createItemSchema)
  create(@Body() body: { name: string }): { readonly name: string } {
    return { name: body.name };
  }
}

@Module({ controllers: [DescriptorUsersController], providers: [DescriptorUsersService] })
class DescriptorRootModule {}

/**
 * The same application, declared the way `aponia build` writes it: the root
 * module's id is the class name the application boots by, and the controller's
 * path, inject list, and routes are data rather than decorator metadata.
 */
const declaredDescriptor = defineModule({
  id: "DescriptorRootModule",
  providers: [provideClass(DescriptorUsersService, [])],
  controllers: [
    defineElysiaControllerRoutes(DescriptorUsersController, {
      path: "users",
      inject: [DescriptorUsersService],
      routes: [
        {
          method: "GET",
          path: ":id",
          propertyKey: "read",
          parameters: [{ index: 0, kind: "params", property: "id" }],
          promiseCapable: false,
        },
        {
          method: "POST",
          path: "items",
          propertyKey: "create",
          parameters: [{ index: 0, kind: "body", property: undefined }],
          schema: { body: t.Object({ name: t.String({ minLength: 2 }) }) },
        },
      ],
    }),
  ],
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

/**
 * An artifact shaped the way `aponia build` writes one. The overrides exist so a
 * case can state provenance the running platform will not accept.
 */
function artifact(
  modules: Readonly<Record<string, unknown>>,
  overrides: Partial<Pick<AponiaModuleDescriptorArtifact, "framework" | "elysia" | "modules">> = {},
): AponiaModuleDescriptorArtifact {
  return Object.freeze({
    framework: frameworkVersion,
    elysia: "1.4.30",
    modules,
    ...overrides,
  }) as AponiaModuleDescriptorArtifact;
}

/** The artifact a build would write for the fixture above. */
const generatedArtifact = (): AponiaModuleDescriptorArtifact =>
  artifact({ DescriptorRootModule: declaredDescriptor });

interface Answer {
  readonly status: number;
  readonly body: string;
}

/** Built per call, because a request body can only be read once. */
function createRequests(): readonly Request[] {
  return [
    new Request("http://localhost/users/7"),
    new Request("http://localhost/users/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    }),
    // The validation failure is the case worth comparing: a declared schema slot
    // reaches Elysia through a different lowering than a decorated one, so an
    // application that answered 200 here would be accepting what it used to reject.
    new Request("http://localhost/users/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "A" }),
    }),
  ];
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
    return await Promise.all(
      createRequests().map(async (request) => {
        const response = await application.handle(request);
        return { status: response.status, body: await response.text() };
      }),
    );
  } finally {
    await application.close();
  }
}

test("serves the declared graph when the artifact holds the root the application names", async () => {
  const logger = new RecordingLogger();
  const compiled = await answers(DescriptorRootModule);
  const declared = await answers(DescriptorRootModule, {
    descriptors: generatedArtifact(),
    logger,
  });

  expect(declared).toEqual(compiled);
  expect(compiled).toEqual([
    { status: 200, body: "read:7" },
    { status: 200, body: JSON.stringify({ name: "Ada" }) },
    { status: 422, body: expect.any(String) },
  ]);
  expect(logger.records).toContainEqual({
    context: "RoutesResolver",
    message:
      "Booting DescriptorRootModule from the generated module descriptors, so the declared graph serves this application.",
  });
});

test("reports the choice only when a descriptor was adopted", async () => {
  const absent = new RecordingLogger();
  await answers(DescriptorRootModule, { logger: absent });
  expect(absent.records.filter((record) => record.message.startsWith("Booting "))).toEqual([]);

  // A module that is already a descriptor names the graph to boot, so there is
  // nothing for the artifact to substitute and nothing to report.
  const direct = new RecordingLogger();
  const declared = await answers(declaredDescriptor, {
    descriptors: generatedArtifact(),
    logger: direct,
  });
  expect(declared).toEqual(await answers(DescriptorRootModule));
  expect(direct.records.filter((record) => record.message.startsWith("Booting "))).toEqual([]);
});

test("lowers the decorated root when the artifact was built by another release", async () => {
  const logger = new RecordingLogger();
  const application = await AponiaFactory.create(DescriptorRootModule, {
    logger,
    descriptors: artifact(
      { DescriptorRootModule: declaredDescriptor },
      {
        framework: "0.0.0",
        elysia: "1.0.0",
      },
    ),
  });

  const response = await application.handle(new Request("http://localhost/users/7"));
  expect(await response.text()).toBe("read:7");

  const refusal = logger.records.find((record) => record.context === "RoutesResolver");
  expect(refusal?.message).toContain("0.0.0");
  expect(refusal?.message).toContain("1.0.0");
  expect(refusal?.message).toContain(frameworkVersion);
  await application.close();
});

test("reports an unresolved Elysia version when it refuses an artifact", async () => {
  const logger = new RecordingLogger();
  const application = await AponiaFactory.create(DescriptorRootModule, {
    logger,
    descriptors: artifact(
      { DescriptorRootModule: declaredDescriptor },
      {
        framework: "0.0.0",
        elysia: null,
      },
    ),
  });
  await application.handle(new Request("http://localhost/users/7"));

  const refusal = logger.records.find((record) => record.context === "RoutesResolver");
  expect(refusal?.message).toContain("an unresolved version");
  await application.close();
});

test("lowers the decorated root when the artifact holds no declaration for it", async () => {
  const logger = new RecordingLogger();
  // What a module renamed since the last build leaves on disk: the artifact is
  // stamped by this release and holds a declaration, just not for the module the
  // application names.
  const renamed = await answers(DescriptorRootModule, {
    descriptors: artifact({ RenamedModule: declaredDescriptor }),
    logger,
  });

  expect(renamed).toEqual(await answers(DescriptorRootModule));
  expect(logger.records).toContainEqual({
    context: "RoutesResolver",
    message:
      'The generated module descriptors hold no declaration for "DescriptorRootModule", so it is lowered ' +
      "from its decorators instead. Run `aponia build` again.",
  });
});

test("lowers the decorated root when the entry it holds is not a module descriptor", async () => {
  const compiled = await answers(DescriptorRootModule);
  // A JavaScript caller has no type checker, and a truncated entry would reach
  // the graph compiler — which is the one outcome the option must never cause.
  const notADescriptor =
    'The generated module descriptors hold a declaration for "DescriptorRootModule" that is not a ' +
    "module descriptor, so it is lowered from its decorators instead. Run `aponia build` again.";
  const entries: readonly (readonly [unknown, string])[] = [
    // An object that is not the shape: a declaration is present but incomplete.
    [{ id: "DescriptorRootModule" }, notADescriptor],
    // A value that is not an object at all, which the `typeof` arm of the guard
    // has to reject before it reads a property from it.
    [null, notADescriptor],
    // A key that holds nothing is reported as what it is: no declaration was
    // read for the module the application named.
    [
      undefined,
      'The generated module descriptors hold no declaration for "DescriptorRootModule", so it is ' +
        "lowered from its decorators instead. Run `aponia build` again.",
    ],
  ];

  for (const [entry, message] of entries) {
    const logger = new RecordingLogger();
    const malformed = await answers(DescriptorRootModule, {
      descriptors: artifact({ DescriptorRootModule: entry }),
      logger,
    });

    expect(malformed).toEqual(compiled);
    expect(logger.records).toContainEqual({ context: "RoutesResolver", message });
  }
});

test("refuses an artifact that carries no module record", async () => {
  const logger = new RecordingLogger();
  const application = await AponiaFactory.create(DescriptorRootModule, {
    logger,
    descriptors: artifact(
      {},
      { modules: [] as unknown as AponiaModuleDescriptorArtifact["modules"] },
    ),
  });

  const response = await application.handle(new Request("http://localhost/users/7"));

  expect(await response.text()).toBe("read:7");
  const refusal = logger.records.find((record) => record.context === "RoutesResolver");
  expect(refusal?.message).toContain("carry no module record");
  await application.close();
});

test("ignores an artifact that is absent rather than empty", async () => {
  // The starter always passes one, so an application that never had a build is
  // the case this records: there is nothing to refuse and nothing to report.
  const application = await AponiaFactory.create(DescriptorRootModule, {
    logger: false,
    descriptors: undefined,
  });
  const response = await application.handle(new Request("http://localhost/users/7"));

  expect(await response.text()).toBe("read:7");
  await application.close();
});

test("does not mutate the supplied artifact", async () => {
  const artifactValue = generatedArtifact();
  const modules = artifactValue.modules;
  const options: AponiaApplicationOptions = { logger: false, descriptors: artifactValue };
  const application = await AponiaFactory.create(DescriptorRootModule, options);

  const response = await application.handle(new Request("http://localhost/users/7"));

  expect(await response.text()).toBe("read:7");
  expect(artifactValue.modules).toBe(modules);
  expect(Object.keys(artifactValue.modules)).toEqual(["DescriptorRootModule"]);
  expect(Object.keys(options)).toEqual(["logger", "descriptors"]);
  await application.close();
});
