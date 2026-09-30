import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  AponiaFactory,
  type AponiaApplicationOptions,
  type ControllerHandlerFactory,
  type AponiaInvokerArtifact,
} from "@aponiajs/platform-elysia";
import { analyzeControllerRoutes, emitControllerInvokers } from "../src/index.ts";
import { aponiaVersion } from "../src/version.ts";

/**
 * The acceptance criterion for build-time route code generation: an application
 * with the generated artifact answers exactly as one without it.
 *
 * The emitter lives in `@aponiajs/cli` and the runtime that consumes its output
 * lives in `@aponiajs/platform-elysia`, so this is the only place the two halves
 * meet. It is why this package carries the platform as a development
 * dependency; the CLI's own source still imports nothing from it.
 */
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const controllerSource = `
import { Body, Controller, Get, Module, Param, Post } from "@aponiajs/common";
import { t } from "elysia";

@Controller("users")
export class UsersController {
  @Get(":id")
  read(@Param("id") id: string): string {
    return \`read:\${id}\`;
  }

  @Post({ body: t.Object({ name: t.String() }) })
  create(@Body() body: { name: string }): string {
    return \`created:\${body.name}\`;
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
`;

/**
 * Generated modules import the controller they were built for, and the
 * application imports the same file, so the pair is written somewhere module
 * resolution can reach the workspace from.
 */
interface Fixture {
  readonly UsersModule: unknown;
  readonly UsersController: unknown;
}

async function generateBesideFixture(source: string): Promise<{
  readonly fixture: Fixture;
  readonly invokers: AponiaApplicationOptions["invokers"];
}> {
  const directory = await mkdtemp(
    join(import.meta.dir, "..", "node_modules", ".aponia-generated-"),
  );
  temporaryDirectories.push(directory);

  const fixturePath = join(directory, "users.controller.ts");
  const generatedPath = join(directory, "invokers.generated.ts");
  // The workspace keeps one synchronized version, so stamping the CLI's own
  // version is what makes the platform accept this artifact — the same reason a
  // generated application accepts the one `aponia build` writes for it.
  const emitted = emitControllerInvokers(
    analyzeControllerRoutes(source, fixturePath),
    { UsersController: "./users.controller.ts" },
    { framework: aponiaVersion, elysia: "1.4.30" },
  );
  if (emitted.source === undefined) {
    throw new Error("The emitter declined every handler in the fixture.");
  }

  await Bun.write(fixturePath, source);
  await Bun.write(generatedPath, emitted.source);

  return {
    fixture: (await import(fixturePath)) as Fixture,
    invokers: (
      (await import(generatedPath)) as {
        readonly controllerInvokerArtifact: AponiaApplicationOptions["invokers"];
      }
    ).controllerInvokerArtifact,
  };
}

interface Answer {
  readonly status: number;
  readonly body: string;
}

async function answers(
  rootModule: unknown,
  options: { readonly invokers?: AponiaApplicationOptions["invokers"] } = {},
): Promise<readonly Answer[]> {
  const application = await AponiaFactory.create(rootModule as never, {
    logger: false,
    invokers: options.invokers,
  });

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
          body: JSON.stringify({ name: 1 }),
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

test("a generated invoker module answers exactly as the compiled path does", async () => {
  const { fixture, invokers } = await generateBesideFixture(controllerSource);

  const compiled = await answers(fixture.UsersModule);
  const generated = await answers(fixture.UsersModule, { invokers });

  expect(generated).toEqual(compiled);
  expect(compiled.map((answer) => answer.status)).toEqual([200, 200, 422]);
  expect(compiled[0]?.body).toBe("read:7");
  expect(compiled[1]?.body).toBe("created:aponia");
});

test("a supplied invoker replaces the compiled binding for its handler", async () => {
  const { fixture } = await generateBesideFixture(controllerSource);
  // The fixture is a dynamic import, so its classes are `unknown` to the checker
  // while being the real class tokens at run time — which is what the lookup
  // below depends on.
  const replaced = {
    framework: aponiaVersion,
    elysia: "1.4.30",
    invokers: new Map<unknown, ControllerHandlerFactory>([
      [
        fixture.UsersController,
        (() => new Map([["read", () => "replaced"]])) as unknown as ControllerHandlerFactory,
      ],
    ]),
  } as unknown as AponiaInvokerArtifact;

  const [read] = await answers(fixture.UsersModule, { invokers: replaced });

  // The entry is keyed by the controller class token, so this only holds when the
  // application really looks invokers up by that token.
  expect(read?.body).toBe("replaced");
});
