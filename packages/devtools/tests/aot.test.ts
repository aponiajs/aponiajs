import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import {
  Controller,
  Get,
  Module,
  defineModule,
  type ClassToken,
  type LoggerService,
} from "@aponiajs/common";
import {
  AponiaFactory,
  type AponiaInvokerArtifact,
  type AponiaModuleDescriptorArtifact,
} from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import {
  aponiaVersion,
  startDevtoolsServer,
  type AponiaAotController,
  type AponiaAotPayload,
  type DevtoolsServer,
} from "../src/index.ts";

/**
 * The build-verdict endpoint. It has two halves that fail differently: the
 * framework facts are the boot record's and are always servable, while the
 * per-handler verdicts come from `@aponiajs/cli`'s analysis, which is imported
 * on the first request and cached for the process.
 *
 * Every case is HTTP against a socket that bound port `0`, and the payload
 * assertions are the wire shape. Three of them are boundaries rather than
 * field names: a handler the emitter declined beside one it emitted, a project
 * a build would refuse beside one it would build, and an adopted artifact
 * beside a refused one — so a payload that guessed on either side fails here.
 *
 * The laziness is proved in a child process, and that is deliberate: the test
 * process may already have loaded `@aponiajs/cli` through another file's
 * imports, so a registry read here could only ever show that nothing was
 * loaded *again*. The child boots the same surface from nothing and reads
 * Bun's module registry itself.
 *
 * The analysis reads source, so a case that wants it to succeed needs a
 * project on disk and a working directory inside it — the root a build
 * defaults to is the process's own.
 */

const initialWorkingDirectory = process.cwd();
const temporaryDirectories: string[] = [];
const warnings: string[] = [];

const recordingLogger: LoggerService = {
  log: () => {},
  fatal: () => {},
  error: () => {},
  warn: (message) => {
    warnings.push(String(message));
  },
};

afterEach(() => {
  process.chdir(initialWorkingDirectory);
  warnings.splice(0);
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * Binds the loopback socket on port `0`, reporting through the case's logger.
 *
 * The logger is a parameter because one case needs a logger that refuses: the
 * row an unreadable project writes is guarded, and a case that could only hand
 * in the recording logger could not reach that guard.
 */
function serveLoopback(
  application: Elysia,
  logger: LoggerService = recordingLogger,
): DevtoolsServer {
  const server = startDevtoolsServer({ application, port: 0, logger });

  if (server === undefined) {
    throw new Error("the devtools server refused to bind the loopback socket");
  }

  return server;
}

async function readAot(server: DevtoolsServer): Promise<AponiaAotPayload> {
  const response = await fetch(`${server.url}/__devtools/aot`);

  expect(response.status).toBe(200);

  return (await response.json()) as AponiaAotPayload;
}

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

/** Writes one project file, creating the directories above it. */
function writeProjectFile(projectRoot: string, path: string, source: string): void {
  const file = join(projectRoot, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}

/**
 * The sentence `aponia build` refuses one project with, read from the command.
 *
 * This endpoint repeats the build's refusals word for word, so the mirroring is
 * the contract: a case that pinned its own copy of a sentence could not tell a
 * faithful mirror from a paraphrase, and a prefix could not tell either of them
 * from a sentence that keeps its opening words and changes the rest. Asking the
 * command — through the package this endpoint itself imports it by — is what
 * makes a wording change on either side fail here instead of shipping.
 *
 * `dryRun` states the whole of what this case wants from the command: the
 * refusal, never a written module. Every refusal read here lands before the
 * first write, and the option holds even if one of them ever moved.
 */
async function commandRefusal(projectRoot: string): Promise<string> {
  const { generateInvokers } = await import("@aponiajs/cli");

  try {
    await generateInvokers({ cwd: projectRoot, dryRun: true });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error(`a build accepted a project this case expects it to refuse: ${projectRoot}`);
}

const projectConfiguration = `{ "sourceRoot": "src" }\n`;

/**
 * The emitter's own sentence for the one decline every fixture here reaches.
 *
 * It is asserted verbatim on purpose: the endpoint's job is to report the
 * build's reasons, so a paraphrase in this package would be the defect.
 */
const wholeContextReason =
  "the handler takes the whole context through a decorator, whose type this package cannot name";

/**
 * One controller with both verdicts and a handler carrying two route
 * decorators: `read` answers two routes through one property key, so it is one
 * handler with one verdict, and `describe` is the one the emitter declines.
 */
const alphaControllerSource = `import { Controller, Ctx, Get, Param } from "@aponiajs/common";

@Controller("alpha")
export class AlphaController {
  @Get()
  list(): string {
    return "list";
  }

  @Get(":id")
  @Get(":id/detail")
  read(@Param("id") id: string): string {
    return id;
  }

  @Get("context")
  describe(@Ctx() context: { readonly request: Request }): string {
    return String(context);
  }
}
`;

const zebraControllerSource = `import { Controller, Post } from "@aponiajs/common";

@Controller("zebra")
export class ZebraController {
  @Post()
  create(): string {
    return "created";
  }
}
`;

/** A controller a build never analyzes: a spec file and the generated module. */
const unanalyzedControllerSource = `import { Controller, Get } from "@aponiajs/common";

@Controller("unanalyzed")
export class UnanalyzedController {
  @Get()
  list(): string {
    return "unanalyzed";
  }
}
`;

/**
 * The controller double an ignored file declares: a second class named
 * `AlphaController`.
 *
 * The name is the whole point. A build's glob ignores test files, and this
 * endpoint repeats that list, so neither reads this file — but if either side
 * stops ignoring it, that side reads two classes of one name and refuses the
 * project, because a generated module addresses a controller by its class name.
 * That is what turns "the two sides apply the same rule" into something a case
 * can assert rather than something a comment claims.
 */
const controllerDoubleSource = `import { Controller, Get } from "@aponiajs/common";

@Controller("double")
export class AlphaController {
  @Get()
  list(): string {
    return "double";
  }
}
`;

/**
 * The two ways a build resolves the source root, each holding the same project:
 * the directory a configuration names, and the default a headless
 * `aponia.json` falls back to.
 */
const ignoredControllerProjects = [
  ["the source root a configuration names", "app", `{ "sourceRoot": "app" }\n`],
  ["the default source root", "src", "{}\n"],
] as const;

/** The verdicts both sides reach for the controller the ignored files double. */
const alphaControllerVerdicts = {
  controller: "AlphaController",
  handlers: [
    { handler: "list", invoker: "generated" },
    { handler: "read", invoker: "generated" },
    {
      handler: "describe",
      invoker: "compiled",
      reason: wholeContextReason,
    },
  ],
} satisfies AponiaAotController;

/**
 * What `aponia build` decides about one project, read from the command.
 *
 * A build either writes the modules or refuses the project, and which one it is
 * is the command's own answer rather than a rule restated here: a mutation of
 * the build's ignore list or source-root resolution turns `accepted` into
 * `refused` for the fixture below, and the case that compares this with the
 * endpoint fails.
 */
async function commandDecision(projectRoot: string): Promise<"accepted" | "refused"> {
  const { generateInvokers } = await import("@aponiajs/cli");

  try {
    await generateInvokers({ cwd: projectRoot, dryRun: true });
  } catch {
    return "refused";
  }

  return "accepted";
}

/**
 * The same decision, read from what the endpoint published.
 *
 * An analysis that refuses the project leaves `controllers` empty and writes one
 * row under `Devtools`, which is the endpoint's own degradation; the fixture's
 * verdicts are asserted beside this, so a loadable but wrong controller list
 * fails the case rather than reading as an agreement.
 */
function endpointDecision(payload: AponiaAotPayload): "accepted" | "refused" {
  return payload.controllers.length === 0 ? "refused" : "accepted";
}

/**
 * A project a build refuses outright: every handler it declares is one the
 * emitter declines, so `aponia build` writes no module at all and names the
 * first decline it found.
 */
const declinedControllerSource = `import { Controller, Ctx, Get } from "@aponiajs/common";

@Controller("only")
export class OnlyController {
  @Get()
  describe(@Ctx() context: { readonly request: Request }): string {
    return String(context);
  }
}
`;

@Controller("aot")
class AotController {
  @Get("ping")
  ping(): string {
    return "pong";
  }
}

@Module({ controllers: [AotController] })
class AppModule {}

const declaredAotModule = defineModule({ id: "DeclaredAotModule" });

test("aot reports the boot's own decision when no project is on disk to analyze", async () => {
  // Nothing is written here: the working directory is the project root a boot
  // would read, and it holds no configuration at all. The boot's facts do not
  // need one, so they are what this endpoint answers with.
  const projectRoot = createTemporaryDirectory("aponia-aot-empty-");
  process.chdir(projectRoot);
  // The directory the loader reports is the process's own, and a temporary
  // directory is reached through a symlink on macOS: read it back rather than
  // expecting the spelling this case created.
  const workingDirectory = process.cwd();
  const application = await AponiaFactory.createNative(AppModule, { logger: false });
  const server = serveLoopback(application);

  try {
    const response = await fetch(`${server.url}/__devtools/aot`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const payload = (await response.json()) as AponiaAotPayload;

    // One assertion for the whole wire shape: a decorated boot was not offered
    // an artifact, so the record carries a refusal reason, and the analysis
    // that could not run leaves the controller list empty rather than failing
    // the endpoint that served these facts.
    expect(payload).toEqual({
      graph: "decorated",
      invokers: { accepted: false, reason: expect.any(String) },
      controllers: [],
    });

    // The second request is answered from the analysis the first one settled,
    // so the failure is reported once for the process rather than once per
    // poll — and the row names the project it could not read.
    expect(await readAot(server)).toEqual(payload);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(workingDirectory);

    // The fourth sentence this package mirrors, read back the way the other
    // three are: the configuration this directory does not have. Comparing the
    // whole parenthetical is the point — the fragment `aponia.json` every
    // spelling of this refusal would carry could not tell the command's own
    // wording from a paraphrase that keeps the file's name and changes the rest.
    const refusal = await commandRefusal(workingDirectory);
    expect(warnings[0]).toContain(`(${refusal}); /aot answers the boot's record alone.`);
  } finally {
    server.stop();
  }
});

test("a report the logger refuses still answers aot's boot half and the degraded list", async () => {
  // The row an unreadable project writes and the empty controller list it
  // degrades to are two halves of one promise, and a promise this endpoint
  // caches: a logger whose `warn` throws would reject that promise, and every
  // poll of this process would be answered with a failure instead of the
  // payload `/aot` promises. The project here is one no analysis can read —
  // the working directory holds no configuration — which is the same
  // degradation the first case asserts, reached with a logger that refuses.
  const projectRoot = createTemporaryDirectory("aponia-aot-refused-");
  process.chdir(projectRoot);
  const workingDirectory = process.cwd();
  const application = await AponiaFactory.createNative(AppModule, { logger: false });
  const refusingLogger: LoggerService = {
    log: () => {},
    fatal: () => {},
    error: () => {},
    warn: () => {
      throw new Error("the logger refused the analysis row");
    },
  };
  const server = serveLoopback(application, refusingLogger);
  const stderr: string[] = [];
  const stderrWrite = spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });

  try {
    // The answer is what the guard is for, and it is asserted before the row:
    // an unguarded `warn` rejects the cached promise, so the request fails
    // with a `500` where the degraded payload belongs — the assertion below
    // fails on that, not only the `stderr` one.
    const response = await fetch(`${server.url}/__devtools/aot`);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as AponiaAotPayload;

    expect(payload).toEqual({
      graph: "decorated",
      invokers: { accepted: false, reason: expect.any(String) },
      controllers: [],
    });

    // The cached promise settled to the degraded list rather than to a
    // rejection, so the second poll is answered the same way rather than
    // failing where the first one did.
    expect(await readAot(server)).toEqual(payload);

    // The sentence a logger refused still reaches a reader, on the channel
    // that survived, and the line says the logger refused it — as a sentence of
    // its own after the report, because the report already ends in a period.
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain("could not read the route analysis");
    expect(stderr[0]).toContain(workingDirectory);
    expect(stderr[0]).toContain("The configured logger threw while reporting it.");
  } finally {
    stderrWrite.mockRestore();
    server.stop();
  }
});

test("a value the analysis threw that refuses to be read still answers the degraded half", async () => {
  // The sentence and the empty list are built together, and the sentence comes
  // first: `oneLine` runs as an argument to `reportFailure`, so it runs before
  // that guard can see it. A reason that refuses to be read would therefore make
  // the report itself the failure, and this is the site where that costs an
  // answer rather than a row — the promise is cached, so a rejection would be
  // served to every later poll instead of the payload `/aot` promises.
  //
  // The analysis is handed no seam by design, so the hostile value is thrown
  // where the analysis makes its first read of the project: `Bun.file` is how it
  // finds `aponia.json`, and a throw there is the analysis's own failure,
  // reached the way any unreadable project is.
  const projectRoot = createTemporaryDirectory("aponia-aot-refusing-");
  process.chdir(projectRoot);
  const application = await AponiaFactory.createNative(AppModule, { logger: false });
  const server = serveLoopback(application);
  const refusing = new Proxy(
    {},
    {
      getPrototypeOf: () => {
        throw new TypeError("this value has no prototype to walk");
      },
    },
  );
  const file = spyOn(Bun, "file").mockImplementation(() => {
    throw refusing;
  });

  try {
    const response = await fetch(`${server.url}/__devtools/aot`);

    // The answer the guard was written for, asserted before the row: without a
    // total sentence build the cached promise rejects and this request fails
    // with a `500` where the degraded payload belongs.
    expect(response.status).toBe(200);

    const payload = (await response.json()) as AponiaAotPayload;

    expect(payload).toEqual({
      graph: "decorated",
      invokers: { accepted: false, reason: expect.any(String) },
      controllers: [],
    });

    // And the row the analysis writes still reaches a reader, naming the project
    // and stating the refusal — the word rather than an empty pair of
    // parentheses, which would read as a reason that was read and was empty.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(projectRoot);
    expect(warnings[0]).toContain("([unrenderable])");
  } finally {
    file.mockRestore();
    server.stop();
  }
});

test("aot reports the emitter's verdicts for the project it is started in", async () => {
  const projectRoot = createTemporaryDirectory("aponia-aot-project-");
  writeProjectFile(projectRoot, "aponia.json", projectConfiguration);
  // Written in the order a directory walk is free to answer in, which is not
  // the order the build reads them: `zebra` first, `alpha` second, and the
  // payload has to state them sorted by path.
  writeProjectFile(projectRoot, "src/zebra/zebra.controller.ts", zebraControllerSource);
  writeProjectFile(projectRoot, "src/alpha/alpha.controller.ts", alphaControllerSource);
  // Neither of these is a controller a build reads: one is a test file and the
  // other is the module the build writes, and both declare a controller that
  // would appear here if the scan differed from the build's.
  writeProjectFile(projectRoot, "src/alpha/alpha.spec.ts", unanalyzedControllerSource);
  writeProjectFile(projectRoot, "src/invokers.generated.ts", unanalyzedControllerSource);
  process.chdir(projectRoot);

  const application = await AponiaFactory.createNative(AppModule, { logger: false });
  const server = serveLoopback(application);

  try {
    const payload = await readAot(server);

    expect(payload).toEqual({
      graph: "decorated",
      invokers: { accepted: false, reason: expect.any(String) },
      controllers: [
        alphaControllerVerdicts,
        { controller: "ZebraController", handlers: [{ handler: "create", invoker: "generated" }] },
      ],
    });

    // The verdicts are the analysis's, and the analysis is read once: a second
    // request answers the same payload from the result the first one settled,
    // and nothing was reported because nothing failed.
    expect(await readAot(server)).toEqual(payload);
    expect(warnings).toEqual([]);
  } finally {
    server.stop();
  }
});

test.each(ignoredControllerProjects)(
  "aot reports the verdicts a build reads under %s, ignored files included",
  async (_description, rootDirectory, configuration) => {
    // One fixture, one rule, read at both ends: the source root and the ignore
    // list are hand-copied from the build, so the case does not assert this
    // package's copy of them — it asserts that the project the command accepts
    // is the project this endpoint reports verdicts for. A build that stopped
    // ignoring the doubles would refuse this project for two classes named
    // `AlphaController`; an endpoint whose copy drifted would refuse it while
    // the build still reads it. Either one fails here rather than shipping a
    // verdict computed over a different file set than `aponia build` reads.
    const projectRoot = createTemporaryDirectory("aponia-aot-ignored-");
    writeProjectFile(projectRoot, "aponia.json", configuration);
    writeProjectFile(
      projectRoot,
      `${rootDirectory}/alpha/alpha.controller.ts`,
      alphaControllerSource,
    );
    // Both globs the build leaves out, each holding a controller double that
    // only a side which stopped honoring the list could read.
    writeProjectFile(projectRoot, `${rootDirectory}/alpha/alpha.test.ts`, controllerDoubleSource);
    writeProjectFile(projectRoot, `${rootDirectory}/alpha/alpha.spec.ts`, controllerDoubleSource);
    process.chdir(projectRoot);

    const application = await AponiaFactory.createNative(AppModule, { logger: false });
    const server = serveLoopback(application);

    try {
      const build = await commandDecision(process.cwd());
      const payload = await readAot(server);

      expect(endpointDecision(payload)).toBe(build);
      // Both refused would be an agreement, not the case: the fixture is a
      // project a build reads, so the command has to have accepted it.
      expect(build).toBe("accepted");

      // And the verdicts are the ones the build reads: the one controller under
      // the source root, however many ignored files double it.
      expect(payload.controllers).toEqual([alphaControllerVerdicts]);
      expect(warnings).toEqual([]);
    } finally {
      server.stop();
    }
  },
);

test("aot reports the verdicts of a project whose every handler a build declined", async () => {
  // The other side of the case above: a build states a verdict for a project it
  // can read even when it writes nothing, so this project — where every handler
  // is declined and `aponia build` therefore refuses to emit a module — is
  // answered with its per-handler reasons rather than the empty list. Those
  // reasons are the whole reason to ask: the build's own failure names the first
  // decline and nothing more.
  const projectRoot = createTemporaryDirectory("aponia-aot-declined-");
  writeProjectFile(projectRoot, "aponia.json", projectConfiguration);
  writeProjectFile(projectRoot, "src/only/only.controller.ts", declinedControllerSource);
  process.chdir(projectRoot);

  const application = await AponiaFactory.createNative(AppModule, { logger: false });
  const server = serveLoopback(application);

  try {
    const payload = await readAot(server);

    expect(payload.graph).toBe("decorated");
    expect(payload.invokers.accepted).toBe(false);
    expect(payload.controllers).toEqual([
      {
        controller: "OnlyController",
        handlers: [{ handler: "describe", invoker: "compiled", reason: wholeContextReason }],
      },
    ]);
    expect(warnings).toEqual([]);
  } finally {
    server.stop();
  }
});

test("aot leaves the controller list empty for a project a build would refuse", async () => {
  // Two verdicts no build produces for two different reasons, and both are
  // reachable in an ordinary tree: a generated module addresses a controller
  // by its class name, so one name two classes share refuses the whole build,
  // and a source root outside the project is a path the build will not read.
  const duplicateNames = createTemporaryDirectory("aponia-aot-duplicate-");
  writeProjectFile(duplicateNames, "aponia.json", projectConfiguration);
  writeProjectFile(duplicateNames, "src/alpha/alpha.controller.ts", alphaControllerSource);
  writeProjectFile(duplicateNames, "src/zebra/duplicate.controller.ts", alphaControllerSource);

  const escapingRoot = createTemporaryDirectory("aponia-aot-escaping-");
  const outside = createTemporaryDirectory("aponia-aot-outside-");
  writeProjectFile(
    escapingRoot,
    "aponia.json",
    `{ "sourceRoot": ${JSON.stringify(relative(escapingRoot, outside))} }\n`,
  );

  // A project that reads perfectly and holds no controller: the third refusal a
  // build can reach, and the one every application passes through between
  // `aponia new` and its first controller. Its source root exists and holds a
  // file, so the scan itself succeeds and the refusal is the analysis's own.
  const controllerless = createTemporaryDirectory("aponia-aot-controllerless-");
  writeProjectFile(controllerless, "aponia.json", projectConfiguration);
  writeProjectFile(controllerless, "src/plain.ts", "export class Plain {}\n");

  for (const projectRoot of [duplicateNames, escapingRoot, controllerless]) {
    process.chdir(projectRoot);
    const application = await AponiaFactory.createNative(AppModule, { logger: false });
    const server = serveLoopback(application);

    try {
      const payload = await readAot(server);
      expect(payload.graph).toBe("decorated");
      expect(payload.controllers).toEqual([]);

      // One row per project per process, however many times it is asked.
      expect((await readAot(server)).controllers).toEqual([]);
      expect(warnings).toHaveLength(1);

      // The row quotes the build's own sentence and nothing else of it, which is
      // why the whole sentence is compared rather than the opening words every
      // spelling of it would share. The command is asked what it says, from the
      // root the endpoint itself read.
      const refusal = await commandRefusal(process.cwd());
      expect(warnings[0]).toContain(`(${refusal}); /aot answers the boot's record alone.`);
    } finally {
      server.stop();
    }
    warnings.splice(0);
  }
});

test("aot reports the declared graph and an adopted artifact without a refusal reason", async () => {
  // The other side of both fields above: a descriptor root the boot compiled
  // as data rather than lowering a class, and an invoker artifact this release
  // adopted. A reason belongs to a refusal, so an adopted artifact has none —
  // and this is the case a payload that restated the selector's sentence would
  // fail, because `reason` would arrive carrying a refusal that never happened.
  const descriptors: AponiaModuleDescriptorArtifact = {
    framework: aponiaVersion,
    elysia: null,
    modules: { AppModule: declaredAotModule },
  };
  const invokers: AponiaInvokerArtifact = {
    framework: aponiaVersion,
    elysia: null,
    invokers: new Map<ClassToken<unknown>, never>(),
  };
  const projectRoot = createTemporaryDirectory("aponia-aot-adopted-");
  process.chdir(projectRoot);
  const application = await AponiaFactory.createNative(AppModule, {
    logger: false,
    descriptors,
    invokers,
  });
  const server = serveLoopback(application);

  try {
    const payload = await readAot(server);

    expect(payload.graph).toBe("declared");
    expect(payload.invokers.accepted).toBe(true);
    expect(Object.hasOwn(payload.invokers, "reason")).toBe(false);
    expect(payload.controllers).toEqual([]);
  } finally {
    server.stop();
  }
});

test.each([
  ["an application no boot produced", undefined],
  ["a record with no invoker verdict", { framework: "9.9.9-future" }],
  [
    "a record whose graph this release does not know",
    { framework: "9.9.9-future", graph: "hybrid", invokers: { accepted: true } },
  ],
] as const)("aot is not served for %s", async (_description, record) => {
  // The record is read through a registry-global symbol key, so it can have
  // been written by a copy of the platform this release does not own — or not
  // written at all. The endpoint states the facts it reports and no others: a
  // record that does not carry them is a path this server does not serve,
  // because a payload built from it could only guess at what it said.
  const application = new Elysia();

  if (record !== undefined) {
    Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
      value: record,
      enumerable: false,
    });
  }

  const server = serveLoopback(application);

  try {
    expect((await fetch(`${server.url}/__devtools/aot`)).status).toBe(404);
    // The server is up either way: an endpoint the record cannot fill is
    // absent rather than the whole surface failing.
    expect((await fetch(`${server.url}/__devtools/meta`)).status).toBe(200);
  } finally {
    server.stop();
  }
});

test("a record that predates the compiled root still answers aot", async () => {
  // The gate is this endpoint's own facts, never `/graph`'s: a copy of the
  // platform older than the compiled root answers the same symbol key with a
  // record that has a graph and an invoker verdict but no `rootModule`, and
  // those two facts are the whole payload.
  const application = new Elysia();
  Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
    value: {
      framework: "0.0.0-older",
      graph: "decorated",
      invokers: { accepted: false, reason: undefined },
    },
    enumerable: false,
  });

  const server = serveLoopback(application);

  try {
    // The record states no reason, so the payload publishes none: an absent
    // reason is what that copy said, and a placeholder would be this package's.
    expect(await readAot(server)).toEqual({
      graph: "decorated",
      invokers: { accepted: false },
      controllers: [],
    });
    expect((await fetch(`${server.url}/__devtools/graph`)).status).toBe(404);
  } finally {
    server.stop();
  }
});

test("starting the devtools surface loads no analyzer, and the first request does", () => {
  // Read in a child, because the registry is the process's: this file's own
  // run may have loaded the analyzer through another lane, and a snapshot here
  // could not tell "not loaded" from "already loaded". The child imports the
  // same surface an application's boot imports, starts a server, and reads
  // Bun's module registry before the import, after it, and after the request.
  const script = `
const analyzerModules = () =>
  Object.keys(require.cache).filter(
    (key) => key.includes("ts-morph") || key.includes("/cli/src/"),
  ).length;
const before = analyzerModules();
const { startDevtoolsServer } = await import(${JSON.stringify(join(import.meta.dir, "..", "src", "index.ts"))});
const afterImport = analyzerModules();
const { Elysia } = await import(${JSON.stringify(Bun.resolveSync("elysia", import.meta.dir))});
const application = new Elysia();
Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
  value: { framework: "0.0.0-probe", graph: "decorated", invokers: { accepted: false, reason: "probe" } },
  enumerable: false,
});
const server = startDevtoolsServer({
  application,
  port: 0,
  logger: { log: () => {}, fatal: () => {}, error: () => {}, warn: () => {} },
});
const response = await fetch(\`\${server.url}/__devtools/aot\`);
await response.json();
const afterRequest = analyzerModules();
server.stop();
console.log(JSON.stringify({ before, afterImport, afterRequest, status: response.status }));
`;

  const child = Bun.spawnSync({
    cmd: [process.execPath, "-e", script],
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (child.exitCode !== 0) {
    throw new Error(`the probe exited ${child.exitCode}: ${child.stderr.toString()}`);
  }

  const observed = JSON.parse(child.stdout.toString().trim()) as {
    readonly before: number;
    readonly afterImport: number;
    readonly afterRequest: number;
    readonly status: number;
  };

  // The endpoint answered — which needs the analysis to have been attempted —
  // and nothing had imported it before the request that asked for it.
  expect(observed.status).toBe(200);
  expect(observed.before).toBe(0);
  expect(observed.afterImport).toBe(0);
  expect(observed.afterRequest).toBeGreaterThan(0);
});
