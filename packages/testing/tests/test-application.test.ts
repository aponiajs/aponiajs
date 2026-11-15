import { expect, test } from "bun:test";
import {
  AponiaError,
  Controller,
  Get,
  Inject,
  Module,
  provideValue,
  type LoggerService,
} from "@aponiajs/common";
import {
  AponiaFactory,
  getApplicationDiagnostics,
  type AponiaApplicationDiagnostics,
} from "@aponiajs/platform-elysia";
import type { AnyElysia } from "elysia";
import { createTestApplication } from "../src/index.ts";
import {
  GreetingService,
  PRIMARY_GREETER,
  SECONDARY_GREETER,
  ShutdownProbe,
  type Greeter,
} from "./fixtures.ts";

/** Reads the boot record, refusing to let an absent one pass as an assertion. */
function diagnosticsOf(application: AnyElysia): AponiaApplicationDiagnostics {
  const diagnostics = getApplicationDiagnostics(application);
  if (!diagnostics) {
    throw new Error("the boot published no diagnostics record");
  }
  return diagnostics;
}

@Controller("greetings")
class GreetingsController {
  constructor(private readonly greeter: GreetingService) {}

  @Get()
  read(): string {
    return this.greeter.greet("Ada");
  }
}

@Controller("token-greetings")
class TokenGreetingsController {
  constructor(@Inject(PRIMARY_GREETER) private readonly greeter: Greeter) {}

  @Get()
  read(): string {
    return this.greeter.greet("Ada");
  }
}

/** The ordinary root: one service, one controller, one route. */
function greetingRoot() {
  @Module({ controllers: [GreetingsController], providers: [GreetingService] })
  class Root {}
  return Root;
}

/**
 * A root whose imported module exports one token and withholds another.
 *
 * The controller reads the exported one, so the boot succeeds; the withheld one
 * is what a read from the root has to be refused for.
 */
function visibilityRoot() {
  @Module({
    providers: [
      provideValue(PRIMARY_GREETER, { greet: (name: string) => `primary ${name}` }),
      provideValue(SECONDARY_GREETER, { greet: (name: string) => `secondary ${name}` }),
    ],
    exports: [PRIMARY_GREETER],
  })
  class FeatureModule {}

  @Module({ imports: [FeatureModule], controllers: [TokenGreetingsController] })
  class Root {}
  return Root;
}

/** A root whose only provider is stopped by the application's shutdown pass. */
function probeRoot() {
  @Module({ providers: [ShutdownProbe] })
  class Root {}
  return Root;
}

/** Records the lines a boot reports, so a case can state that it reported any. */
class MemoryLogger implements LoggerService {
  readonly lines: string[] = [];

  log(message: unknown): void {
    this.lines.push(String(message));
  }

  error(message: unknown): void {
    this.lines.push(String(message));
  }

  warn(message: unknown): void {
    this.lines.push(String(message));
  }

  fatal(message: unknown): void {
    this.lines.push(String(message));
  }
}

/**
 * Captures what a boot writes to the process streams.
 *
 * The system logger writes to `stdout` and `stderr` directly rather than through
 * `console`, so those two writes are the whole of what it can reach.
 */
function captureProcessStreams(): {
  readonly stdout: string[];
  readonly stderr: string[];
  restore(): void;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown): boolean => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown): boolean => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    stdout,
    stderr,
    restore(): void {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
    },
  };
}

const BOOT_LINE = "AponiaFactory";

test("silences the logger unless a case asks for one", async () => {
  const captured = captureProcessStreams();

  try {
    const silenced = await createTestApplication(greetingRoot()).compile();
    await silenced.close();

    const reporting = await AponiaFactory.create(greetingRoot());
    await reporting.close();

    // The measurement is not vacuous: the same capture saw a plain boot report.
    const bootLines = [...captured.stdout, ...captured.stderr].filter((line) =>
      line.includes(BOOT_LINE),
    );
    expect(bootLines.length).toBeGreaterThan(0);

    const silentLines = bootLines.filter((line) => line.includes("Starting Aponia application"));
    // Exactly one boot reported, and it is the factory's own default.
    expect(silentLines).toHaveLength(1);
  } finally {
    captured.restore();
  }
});

test("passes the options through, including a logger a case wants to read", async () => {
  const logger = new MemoryLogger();
  const application = await createTestApplication(greetingRoot(), { logger }).compile();

  try {
    expect(logger.lines).toContain("Starting Aponia application...");
    expect(logger.lines.some((line) => line.includes("GreetingsController"))).toBe(true);
  } finally {
    await application.close();
  }
});

test("boots exactly as the factory boots when nothing is overridden", async () => {
  const root = greetingRoot();
  const tested = await createTestApplication(root).compile();
  const plain = await AponiaFactory.create(root, { logger: false });

  try {
    const testedDiagnostics = diagnosticsOf(tested.application.getNativeApplication());
    const plainDiagnostics = diagnosticsOf(plain.getNativeApplication());

    // The no-override path hands the root straight to the factory, so a decorated
    // root still reports as the lowered graph rather than as a declared one.
    expect(testedDiagnostics.graph).toBe("decorated");
    expect(testedDiagnostics.graph).toBe(plainDiagnostics.graph);
    expect(testedDiagnostics.rootModule.id).toBe(plainDiagnostics.rootModule.id);
    expect(testedDiagnostics.framework).toBe(plainDiagnostics.framework);

    const request = (): Request => new Request("http://localhost/greetings");
    expect(await (await tested.handle(request())).text()).toBe(
      await (await plain.handle(request())).text(),
    );
  } finally {
    await tested.close();
    await plain.close();
  }
});

test("answers a request with no listener bound, and refuses a url without one", async () => {
  const application = await createTestApplication(greetingRoot()).compile();

  try {
    expect(await (await application.handle(new Request("http://localhost/greetings"))).text()).toBe(
      "Hello, Ada!",
    );

    let failure: unknown;
    try {
      application.application.getUrl();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("APPLICATION_NOT_LISTENING");
  } finally {
    await application.close();
  }
});

test("keeps the application's own visibility rules when a token is read back", async () => {
  const application = await createTestApplication(visibilityRoot()).compile();

  try {
    expect(
      await (await application.handle(new Request("http://localhost/token-greetings"))).text(),
    ).toBe("primary Ada");
    expect(application.get(PRIMARY_GREETER)).toEqual({ greet: expect.any(Function) });

    // The imported module provides the second token but does not export it, so a
    // read from the root cannot reach it — the wrapper adds no visibility.
    let failure: unknown;
    try {
      application.get(SECONDARY_GREETER);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MISSING_PROVIDER");
  } finally {
    await application.close();
  }
});

test("runs the shutdown hooks once, however many times it is closed", async () => {
  const application = await createTestApplication(probeRoot()).compile();
  const probe = application.get(ShutdownProbe);
  expect(probe.shutdowns).toBe(0);

  await application.close();
  await application.close();

  expect(probe.shutdowns).toBe(1);
});

test("disposes through await using, so a boot cannot outlive its scope", async () => {
  const probe = await (async () => {
    await using application = await createTestApplication(probeRoot()).compile();
    return application.get(ShutdownProbe);
  })();

  expect(probe.shutdowns).toBe(1);
});

test("binds a real port for the cases that need one, and releases it on close", async () => {
  const application = await createTestApplication(greetingRoot()).compile();

  try {
    const server = await application.listen();

    // Both urls name the one socket, which is what a WebSocket upgrade needs and
    // the reason this harness opens a port at all.
    expect(server.url).toMatch(/^http:\/\/localhost:\d+$/);
    expect(server.webSocketUrl).toBe(server.url.replace(/^http/, "ws"));
    expect(await (await fetch(`${server.url}/greetings`)).text()).toBe("Hello, Ada!");

    await application.close();

    // Nothing still answers on the socket, so a case that forgot to close cannot
    // leave a listener behind for the rest of the run to trip over.
    const afterClose = await fetch(`${server.url}/greetings`).then(
      () => "answered",
      () => "refused",
    );
    expect(afterClose).toBe("refused");
  } finally {
    await application.close();
  }
});
