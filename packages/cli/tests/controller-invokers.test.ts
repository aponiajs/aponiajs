import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { analyzeControllerRoutes, emitControllerInvokers } from "../src/index.ts";

type RouteInvoker = (context: never) => unknown;
type ControllerInvokerFactory = (instance: never) => ReadonlyMap<string | symbol, RouteInvoker>;
type InvokerFactories = Map<unknown, ControllerInvokerFactory>;

/** Fixed provenance, so an emitted-module assertion does not move with a release. */
const provenance = Object.freeze({ framework: "1.2.3", elysia: "1.4.30" });

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/**
 * Generated modules import the controller they were built for, and that
 * controller imports the framework, so the pair has to live somewhere module
 * resolution can reach the workspace from — the system temporary directory has
 * no path to the workspace.
 *
 * It goes under `node_modules` rather than beside this file for a second
 * reason: the coverage lane instruments every file the run executes, so a
 * fixture written inside the package would be reported as measured source and
 * would drag the aggregate down with code no one is expected to test.
 */
async function createResolvableDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(import.meta.dir, "..", "node_modules", prefix));
  temporaryDirectories.push(directory);
  return directory;
}

const controllerSource = `
import { Body, Controller, Cookie, Context, Get, Param, Post } from "@aponiajs/common";

@Controller("users")
export class UsersController {
  @Post(":id")
  create(@Param("id") id: string, @Body() body: { name: string }): string {
    return id + body.name;
  }

  @Get("theme")
  theme(@Cookie("theme") theme: string | undefined): string {
    return theme ?? "none";
  }

  @Get("ctx")
  takers(@Context() whole: unknown): unknown {
    return whole;
  }

  @Get()
  noop(): string {
    return "noop";
  }
}
`;

function emit(
  source: string,
  imports: Readonly<Record<string, string>> = { UsersController: "./users.controller.ts" },
) {
  return emitControllerInvokers(
    analyzeControllerRoutes(source, "users.controller.ts"),
    imports,
    provenance,
  );
}

/**
 * Writes the generated module beside a matching fixture and imports it, so the
 * invokers can be called for real. Asserting on the emitted text alone would
 * not prove that what it emits runs.
 */
async function loadGenerated(source: string): Promise<{
  readonly emitted: ReturnType<typeof emitControllerInvokers>;
  readonly factories: InvokerFactories | undefined;
  readonly controller: Function;
}> {
  const directory = await createResolvableDirectory(".aponia-invokers-");
  const fixturePath = join(directory, "users.controller.ts");
  const generatedPath = join(directory, "invokers.generated.ts");
  const emitted = emitControllerInvokers(
    analyzeControllerRoutes(source, fixturePath),
    { UsersController: "./users.controller.ts" },
    provenance,
  );

  await Bun.write(fixturePath, source);
  if (emitted.source !== undefined) {
    await Bun.write(generatedPath, emitted.source);
  }

  const factories =
    emitted.source === undefined
      ? undefined
      : (
          (await import(generatedPath)) as {
            controllerInvokerArtifact: { readonly invokers: InvokerFactories };
          }
        ).controllerInvokerArtifact.invokers;
  const controller = ((await import(fixturePath)) as { UsersController: Function }).UsersController;

  return { emitted, factories, controller };
}

/** The invokers the generated factory produces for one instance. */
function invokersFor(
  factories: InvokerFactories | undefined,
  controller: Function,
  instance: object,
): ReadonlyMap<string | symbol, RouteInvoker> {
  const factory = factories?.get(controller);
  if (factory === undefined) {
    throw new Error("The generated module has no factory for this controller.");
  }

  return factory(instance as never);
}

test("generates an entry per handler that declares a decorated parameter", () => {
  const result = emit(controllerSource);

  expect(result.source).toBeDefined();
  expect(result.source).toContain('"create"');
  expect(result.source).toContain('"theme"');
  expect(result.source).toContain('"noop"');
  expect(result.source).not.toContain('"takers"');
  expect(result.source).toContain('import { UsersController } from "./users.controller.ts";');
  expect(result.source).toContain('import type { ClassToken } from "@aponiajs/common";');
  // A read is guarded against a context field that is not an object, which
  // leaves `undefined` in the alternative, so it is asserted to the type the
  // application annotated that parameter with. The runtime value is unchanged;
  // what the assertion buys is a generated module that passes the application's
  // own type check.
  expect(result.source).toContain('as Parameters<UsersController["create"]>[0]');
});

test("declines a handler whose bindings it cannot reproduce, naming the reason", () => {
  const result = emit(controllerSource);

  expect(result.declined.map((entry) => entry.method)).toEqual(["takers"]);
  expect(result.declined.every((entry) => entry.controller === "UsersController")).toBe(true);
  for (const entry of result.declined) {
    expect(entry.reason.length).toBeGreaterThan(0);
  }
});

test("declines every handler of a controller it was given no specifier for", () => {
  const result = emit(controllerSource, {});

  expect(result.source).toBeUndefined();
  expect(result.declined).toHaveLength(4);
});

test("returns no source when every handler is declined", () => {
  const result = emit(
    `
import { Controller, Context, Get } from "@aponiajs/common";

@Controller("empty")
export class EmptyController {
  @Get()
  read(@Context() context: unknown): unknown {
    return context;
  }
}
`,
    { EmptyController: "./empty.controller.ts" },
  );

  expect(result.source).toBeUndefined();
  expect(result.declined).toHaveLength(1);
});

test("declines a handler that declares nothing but reads arguments", () => {
  const result = emit(
    `
import { Controller, Get } from "@aponiajs/common";

@Controller("legacy")
export class LegacyController {
  @Get()
  read(): unknown {
    return arguments[0];
  }
}
`,
    { LegacyController: "./legacy.controller.ts" },
  );

  // The runtime hands such a handler the context, and there is no declared
  // parameter to type it from, so it stays on the compiled path.
  expect(result.source).toBeUndefined();
  expect(result.declined.map((entry) => entry.method)).toEqual(["read"]);
});

test("binds the platform response settings and the native request", async () => {
  const { factories, controller } = await loadGenerated(`
import { Controller, Req, ResponseSettings, Get } from "@aponiajs/common";

@Controller("native")
export class UsersController {
  @Get()
  read(@ResponseSettings() set: unknown, @Req() request: unknown): string {
    return "read";
  }
}
`);
  const received: unknown[][] = [];
  const instance = {
    read(...arguments_: unknown[]): string {
      received.push(arguments_);
      return "native";
    },
  };

  const invoker = invokersFor(factories, controller, instance).get("read");
  expect(invoker).toBeDefined();

  const settings = { headers: {} };
  const request = { url: "http://localhost/native" };
  expect(invoker!({ set: settings, request } as never)).toBe("native");
  expect(received).toEqual([[settings, request]]);
});

test("passes the selected path parameter and the body in declaration order", async () => {
  const { factories, controller } = await loadGenerated(controllerSource);
  const received: unknown[][] = [];
  const instance = {
    create(...arguments_: unknown[]): string {
      received.push(arguments_);
      return "created";
    },
  };

  const invoker = invokersFor(factories, controller, instance).get("create");
  expect(invoker).toBeDefined();

  expect(invoker!({ params: { id: "42" }, body: { name: "aponia" } } as never)).toBe("created");
  expect(received).toEqual([["42", { name: "aponia" }]]);
});

test("reads a selected cookie property and tolerates a missing one", async () => {
  const { factories, controller } = await loadGenerated(controllerSource);
  const received: unknown[] = [];
  const instance = {
    theme(theme: unknown): string {
      received.push(theme);
      return "themed";
    },
  };

  const invoker = invokersFor(factories, controller, instance).get("theme");
  expect(invoker).toBeDefined();

  expect(invoker!({ cookie: { theme: { value: "dark" } } } as never)).toBe("themed");
  expect(invoker!({ cookie: {} } as never)).toBe("themed");
  expect(invoker!({} as never)).toBe("themed");
  expect(received).toEqual(["dark", undefined, undefined]);
});

test("fills a gap below a decorated parameter with undefined", async () => {
  const { emitted, factories, controller } = await loadGenerated(`
import { Body, Controller, Post } from "@aponiajs/common";

@Controller("gaps")
export class UsersController {
  @Post()
  create(_ignored: string, @Body() body: { name: string }): string {
    return body.name;
  }
}
`);
  const received: unknown[][] = [];
  const instance = {
    create(...arguments_: unknown[]): string {
      received.push(arguments_);
      return "gapped";
    },
  };

  const invoker = invokersFor(factories, controller, instance).get("create");
  expect(invoker).toBeDefined();

  expect(invoker!({ body: { name: "aponia" } } as never)).toBe("gapped");
  expect(received).toEqual([[undefined, { name: "aponia" }]]);

  // The gap is `undefined` at run time while the application annotated that
  // parameter `string`, so the argument is asserted to the annotation. The
  // platform's own binding passes the same value, and the committed module is
  // source in the application's own type check.
  expect(emitted.source).toContain('undefined as Parameters<UsersController["create"]>[0]');
});

test("gives a handler with no decorated parameter what the runtime gives it", async () => {
  const { factories, controller } = await loadGenerated(`
import { Controller, Get } from "@aponiajs/common";

@Controller("shapes")
export class UsersController {
  @Get("bare")
  bare(): string {
    return "bare";
  }

  @Get("whole")
  whole(context: unknown): unknown {
    return context;
  }
}
`);
  const received: unknown[][] = [];
  const instance = {
    bare(...arguments_: unknown[]): string {
      received.push(arguments_);
      return "bare";
    },
    whole(...arguments_: unknown[]): string {
      received.push(arguments_);
      return "whole";
    },
  };

  const invokers = invokersFor(factories, controller, instance);

  // A handler with no declared parameter receives nothing, and one that declares
  // a parameter receives the whole context — the runtime's rule, reproduced.
  expect(invokers.get("bare")!({} as never)).toBe("bare");
  expect(invokers.get("whole")!({ request: "ctx" } as never)).toBe("whole");
  expect(received).toEqual([[], [{ request: "ctx" }]]);
});
