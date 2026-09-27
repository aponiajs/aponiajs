import { expect, spyOn, test } from "bun:test";
import { Logger, Module, type LoggerService } from "@aponiajs/common";
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
// The reachability check the tap is reached through, imported from its own module
// because it is marked `@internal` and deliberately kept off the barrel for this
// package's cases — the same arrangement `isLoopbackHost` has in `server.test.ts`.
import { isRecordableLogger } from "../src/logging/log-tap.ts";
import {
  DevtoolsModule,
  createLogBuffer,
  startDevtoolsServer,
  tapLogBuffer,
  type AponiaLogsPayload,
  type DevtoolsServer,
  type LogEntry,
  type TappedLogStream,
} from "../src/index.ts";

/**
 * The bounded log stream and the endpoint that publishes it.
 *
 * The stream comes from the registration: the logger an application hands
 * `DevtoolsModule.register` is the object `/logs` records — the same one it hands
 * the factory — so a case boots a real application and writes through the logger
 * it owns to pin what a client observes. The contract is HTTP and a cursor, so
 * every socket binds port `0` and the address is read back — off the server
 * handle, or out of the `Devtools` report. No case depends on a port it guessed.
 *
 * The cursor and the ring are where a test can quietly become useless — a
 * fixture whose input order already equals its expected order, or an assertion
 * that re-implements the comparator it is checking — so the assertions below
 * name the exact lines each read answers with rather than their count, and the
 * lines are written in an order that would fail if the buffer kept the newest
 * instead of the oldest, or answered a poll with what the poll had seen.
 */

const silentLogger: LoggerService = {
  log: () => {},
  fatal: () => {},
  error: () => {},
  warn: () => {},
};

/** One entry as a case writes it, so a read is asserted by the line it names. */
function entry(message: string): LogEntry {
  return { level: "log", context: "", message, timestamp: new Date(0).toISOString() };
}

function messagesOf(read: { readonly entries: readonly LogEntry[] }): readonly string[] {
  return read.entries.map((item) => item.message);
}

test("a read answers the entries after its cursor and the cursor to pass back", () => {
  const buffer = createLogBuffer(10);
  buffer.write(entry("first"));
  buffer.write(entry("second"));

  const opened = buffer.since(0);

  expect(messagesOf(opened)).toEqual(["first", "second"]);
  expect(opened.cursor).toBe(2);

  buffer.write(entry("third"));

  // The cursor the previous read answered with is what a poller passes back: it
  // must name the line written since, and nothing the poll already saw.
  const polled = buffer.since(opened.cursor);

  expect(messagesOf(polled)).toEqual(["third"]);
  expect(polled.cursor).toBe(3);
});

test("the buffer holds exactly its capacity and drops the oldest entries", () => {
  const buffer = createLogBuffer(3);
  for (const message of ["one", "two", "three", "four", "five"]) {
    buffer.write(entry(message));
  }

  const whole = buffer.since(0);

  // Five lines written, three retained: the two oldest are gone, and what
  // remains is the newest three in the order they were written.
  expect(whole.entries).toHaveLength(3);
  expect(messagesOf(whole)).toEqual(["three", "four", "five"]);
  expect(whole.cursor).toBe(5);
});

test("a buffer with no capacity retains nothing and still counts every write", () => {
  const buffer = createLogBuffer(0);

  buffer.write(entry("one"));
  buffer.write(entry("two"));

  // The bound is the whole contract, so the smallest bound holds no line at all
  // rather than the newest one — and the cursor still moves, because a poller
  // that reads an empty window must still be able to see that it did.
  const read = buffer.since(0);

  expect(read.entries).toEqual([]);
  expect(read.cursor).toBe(2);
  expect(messagesOf(buffer.since(1))).toEqual([]);
});

test("a cursor older than the window slides to the front of it, and one ahead answers nothing", () => {
  const buffer = createLogBuffer(3);
  for (const message of ["one", "two", "three", "four", "five"]) {
    buffer.write(entry(message));
  }

  // Cursor 1 is older than the window — the line at that position has been
  // dropped — and it reads what is retained rather than a stale offset.
  expect(messagesOf(buffer.since(1))).toEqual(["three", "four", "five"]);

  // Cursor 2 is the oldest cursor the window still covers, and its answer starts
  // at the line written after it — the first one retained.
  expect(messagesOf(buffer.since(2))).toEqual(["three", "four", "five"]);
  expect(messagesOf(buffer.since(4))).toEqual(["five"]);

  // A cursor ahead of every write answers nothing rather than throwing, and the
  // cursor it answers with has not moved backwards.
  const beyond = buffer.since(999);
  expect(beyond.entries).toEqual([]);
  expect(beyond.cursor).toBe(5);
});

test("a read is a frozen copy, so a later write cannot change the answer it gave", () => {
  const buffer = createLogBuffer(2);
  buffer.write(entry("first"));

  const read = buffer.since(0);

  expect(Object.isFrozen(read)).toBe(true);
  expect(Object.isFrozen(read.entries)).toBe(true);

  buffer.write(entry("second"));

  expect(messagesOf(read)).toEqual(["first"]);
});

/**
 * A logger the case owns: the calls it received, and the object it handed over.
 * The tap is asserted against a logger this file writes rather than against the
 * framework's own, because what the tap must not change is the object, and only
 * a logger whose methods are visible here can show that.
 */
function fakeLogger(): { readonly logger: LoggerService; readonly calls: readonly string[] } {
  const calls: string[] = [];
  const record =
    (level: string) =>
    (message: unknown): void => {
      calls.push(`${level} ${String(message)}`);
    };

  return {
    calls,
    logger: {
      log: record("log"),
      fatal: record("fatal"),
      error: record("error"),
      warn: record("warn"),
    },
  };
}

test("the tap records each line and still writes it through the same logger", () => {
  const { logger, calls } = fakeLogger();
  const buffer = createLogBuffer(4);

  const tapped = tapLogBuffer(logger, buffer);

  // The stream that records it is the answer, and the logger is the object the
  // caller already held: the lines written through that reference are the lines
  // this records, which is what patching in place buys and a wrapper could not.
  expect(tapped?.buffer).toBe(buffer);
  // The stream states the levels it reached, and this logger carries the four a
  // plain object declares, so every one of them was patched.
  expect(tapped?.levels).toContain("log");
  expect(tapped?.levels).toContain("warn");

  logger.log("serving", "RouterExplorer");
  logger.warn("slow", "HealthController");

  expect(calls).toEqual(["log serving", "warn slow"]);
  expect(
    buffer
      .since(0)
      .entries.map((item) => [item.level, item.context, item.message] satisfies unknown[]),
  ).toEqual([
    ["log", "RouterExplorer", "serving"],
    ["warn", "HealthController", "slow"],
  ]);
});

test("a line is recorded even when the logger's own write throws", () => {
  const buffer = createLogBuffer(4);
  const logger: LoggerService = {
    log: () => {},
    fatal: () => {},
    error: () => {},
    warn: () => {
      throw new Error("the console is closed");
    },
  };
  tapLogBuffer(logger, buffer);

  // The failure is the logger's own and still reaches the caller, because the
  // method that was already there is the one that ran. The line it failed to
  // print is recorded anyway: the entry is written to the stream before the
  // logger's own write runs, and a stream that lost the lines a failing logger
  // wrote would be least useful exactly where it is most needed.
  expect(() => logger.warn("written before the failure", "LogsTest")).toThrow(
    "the console is closed",
  );
  expect(
    buffer
      .since(0)
      .entries.map((item) => [item.level, item.context, item.message] satisfies unknown[]),
  ).toEqual([["warn", "LogsTest", "written before the failure"]]);
});

test("a context the caller did not name is recorded as empty, with an ISO timestamp", () => {
  const { logger } = fakeLogger();
  const buffer = createLogBuffer(4);
  tapLogBuffer(logger, buffer);

  logger.log("serving", 1024, "RouterExplorer");
  logger.error("storage is full");

  const [named, unnamed] = buffer.since(0).entries;

  // The last optional parameter is the one that names the context, which is the
  // argument a caller writes last whatever else it passed.
  expect(named?.context).toBe("RouterExplorer");
  // Nothing named the context here, so the entry states that absence rather than
  // the logger's own configured context, which is private to the logger.
  expect(unnamed?.context).toBe("");
  expect(unnamed?.level).toBe("error");
  expect(unnamed?.message).toBe("storage is full");
  expect(unnamed?.timestamp).toBe(new Date(unnamed?.timestamp ?? "").toISOString());
});

test("a message is projected to text whatever the logger was handed", () => {
  const { logger } = fakeLogger();
  const buffer = createLogBuffer(8);
  tapLogBuffer(logger, buffer);

  const circular: Record<string, unknown> = {};
  circular.self = circular;

  logger.log("plain");
  logger.log(42);
  logger.log(undefined);
  logger.log(function named() {});
  logger.log(function () {});
  logger.log(new Error("boom"));
  logger.log({ users: 2 });
  logger.log(circular);

  // Every one of them is text on the wire, and the shapes a payload builder
  // cannot serialize — an `Error`, a function, a value that refers to itself —
  // are projected here rather than failing the request that reads them.
  expect(messagesOf(buffer.since(0))).toEqual([
    "plain",
    "42",
    "undefined",
    "named",
    "(anonymous)",
    "Error: boom",
    '{"users":2}',
    "[object Object]",
  ]);
});

test("one logger records into one stream, so a line is never recorded or printed twice", () => {
  const { logger, calls } = fakeLogger();
  const first = createLogBuffer(4);
  const second = createLogBuffer(4);

  expect(tapLogBuffer(logger, first)?.buffer).toBe(first);
  // A second registration naming the same logger is answered with the stream that
  // is already recording, so the lines a client polls and the lines the logger
  // writes cannot drift apart.
  expect(tapLogBuffer(logger, second)?.buffer).toBe(first);

  logger.log("once");

  expect(calls).toEqual(["log once"]);
  expect(first.since(0).entries).toHaveLength(1);
  expect(second.since(0).entries).toEqual([]);
});

test("a logger no level could be patched on is answered with no stream, not an empty one", () => {
  const { logger, calls } = fakeLogger();
  const buffer = createLogBuffer(4);
  Object.freeze(logger);

  const tapped = tapLogBuffer(logger, buffer);

  // Nothing was installed, so the buffer will never hold a line: handing it back
  // would be an empty stream published over a logger that goes on printing, which
  // is the false silence this package refuses everywhere else.
  expect(tapped).toBeUndefined();

  logger.log("still writes");

  expect(calls).toEqual(["log still writes"]);
  expect(buffer.since(0).entries).toEqual([]);
  // A logger nothing could be installed on is not remembered as one that has a
  // stream, so a later tap retries and answers the same absence.
  expect(tapLogBuffer(logger, buffer)).toBeUndefined();
});

test("a logger that refuses one assignment is still recorded and published", () => {
  const { logger, calls } = fakeLogger();
  const buffer = createLogBuffer(4);
  // `fatal` is the level the tap reaches second, and it refuses the assignment:
  // `log` was patched before the refusal landed, so the tap genuinely installed.
  // The property is taken as a descriptor rather than read off the logger, because
  // the method is being redefined, not called.
  Object.defineProperty(logger, "fatal", {
    ...Object.getOwnPropertyDescriptor(logger, "fatal"),
    writable: false,
  });

  const tapped = tapLogBuffer(logger, buffer);

  // The stream is the answer, and that is the boundary this pins: the absence
  // belongs to a logger no level could be patched on, not to every refusal. A
  // logger that accepts one assignment and refuses the next has a tap the lines
  // through it reach, so handing `undefined` back here would drop lines this
  // package is recording.
  expect(tapped?.buffer).toBe(buffer);

  logger.log("recorded through the patch");
  // The level the refusal landed on keeps the method it had, and the levels after
  // it are still reached: a refusal costs the level it landed on rather than that
  // level and every one after it, so `warn` is patched like any other.
  logger.fatal("written through the method it kept");
  logger.warn("reached past the refusal");

  expect(calls).toEqual([
    "log recorded through the patch",
    "fatal written through the method it kept",
    "warn reached past the refusal",
  ]);
  expect(
    buffer.since(0).entries.map((item) => [item.level, item.message] satisfies unknown[]),
  ).toEqual([
    ["log", "recorded through the patch"],
    ["warn", "reached past the refusal"],
  ]);
  // The stream states which levels it reached, so the level that refused is named
  // as unreached and the level after it is named as recorded — the two facts this
  // case exists to tell apart from the payload alone.
  expect(tapped?.levels).toContain("warn");
  expect(tapped?.levels).not.toContain("fatal");
});

test("a logger whose first level refuses while a later level accepts is still published", () => {
  const { logger, calls } = fakeLogger();
  const buffer = createLogBuffer(4);
  // `log` is the level the tap reaches first, and it refuses the assignment while
  // `fatal`, `error`, and `warn` accept theirs. The boundary is the number of
  // levels patched rather than where the first refusal landed, so this logger has
  // a tap the lines through `fatal` reach and the stream is the answer — the
  // counterexample a "first assignment refuses" rule would get wrong.
  Object.defineProperty(logger, "log", {
    ...Object.getOwnPropertyDescriptor(logger, "log"),
    writable: false,
  });

  const tapped = tapLogBuffer(logger, buffer);

  expect(tapped?.buffer).toBe(buffer);
  expect(tapped?.levels).not.toContain("log");
  expect(tapped?.levels).toContain("fatal");

  logger.fatal("recorded through the patch");

  expect(calls).toEqual(["fatal recorded through the patch"]);
  expect(buffer.since(0).entries.map((item) => item.level)).toEqual(["fatal"]);
});

test("a stream names the levels the tap reached", () => {
  const logger = new Logger("Test", { timestamp: false });
  // A level the object does not carry is a level the tap cannot reach, and the
  // payload has to say so rather than leave it to be inferred from an absence.
  // `debug` is optional on `LoggerService`, and the concrete logger declares it
  // on its prototype — which a `delete` of an own property would not remove — so
  // the own property set to `undefined` is how this logger lacks the level.
  Object.defineProperty(logger, "debug", {
    value: undefined,
    writable: true,
    configurable: true,
  });

  const tapped = tapLogBuffer(logger, createLogBuffer(4));

  expect(tapped?.levels).toContain("log");
  expect(tapped?.levels).not.toContain("debug");
});

test("a level that refuses its assignment does not cost the levels after it", () => {
  // A logger that declares every level as its own property, so the level that is
  // redefined below is the level the tap reads — the concrete `Logger` declares
  // its levels on the prototype, where an own descriptor cannot reach them.
  const calls: string[] = [];
  const record =
    (level: string) =>
    (message: unknown): void => {
      calls.push(`${level} ${String(message)}`);
    };
  const logger: LoggerService = {
    log: record("log"),
    fatal: record("fatal"),
    error: record("error"),
    warn: record("warn"),
    debug: record("debug"),
    verbose: record("verbose"),
  };
  // `error` is the third level the tap reaches, so `log` and `fatal` are patched
  // before the refusal lands and `warn`, `debug`, and `verbose` come after it. A
  // non-writable own property is how a logger refuses one assignment and accepts
  // the others; the descriptor form is used because the method is redefined, not
  // called.
  Object.defineProperty(logger, "error", {
    ...Object.getOwnPropertyDescriptor(logger, "error"),
    writable: false,
  });

  const tapped = tapLogBuffer(logger, createLogBuffer(4));

  expect(tapped?.levels).toContain("log");
  expect(tapped?.levels).not.toContain("error");
  // `verbose` is the last level the tap attempts, so naming it is what shows the
  // loop kept going past the refusal instead of stopping on it.
  expect(tapped?.levels).toContain("verbose");
});

test("a level whose read throws does not escape the tap", () => {
  // A logger is a live object, and a getter — or a `Proxy` — can refuse the
  // **read** rather than the assignment. The tap runs at registration, while a
  // module is being declared, so a read that escaped would fail the boot rather
  // than cost one level. `error` is the third level in the order, so a later level
  // is what throws and the levels after it have to survive it.
  const calls: string[] = [];
  const record =
    (level: string) =>
    (message: unknown): void => {
      calls.push(`${level} ${String(message)}`);
    };
  const logger: LoggerService = {
    log: record("log"),
    fatal: record("fatal"),
    error: record("error"),
    warn: record("warn"),
    debug: record("debug"),
    verbose: record("verbose"),
  };
  Object.defineProperty(logger, "error", {
    get(): never {
      throw new Error("this logger refuses the read");
    },
    configurable: true,
  });

  const buffer = createLogBuffer(4);
  const tapped = tapLogBuffer(logger, buffer);

  // The level whose read threw is not named as one the tap reached, and it costs
  // only itself: `verbose` is last in the order, so naming it is what shows the
  // loop kept going past the read that threw.
  expect(tapped?.levels).toContain("log");
  expect(tapped?.levels).not.toContain("error");
  expect(tapped?.levels).toContain("verbose");

  logger.log("recorded");
  expect(calls).toContain("log recorded");
  expect(
    buffer.since(0).entries.map((item) => [item.level, item.message] satisfies unknown[]),
  ).toEqual([["log", "recorded"]]);
});

test("a logger nothing can be read from is answered with no stream", () => {
  // The other end of the same rule. Nothing could be read, so nothing was patched:
  // the answer is the absence the endpoint's `404` stands on, and it is answered
  // rather than thrown, because this call runs while a module is being declared.
  const logger = new Proxy({} as LoggerService, {
    get(): never {
      throw new Error("this logger refuses the read");
    },
  });

  expect(tapLogBuffer(logger, createLogBuffer(4))).toBeUndefined();
});

test("the reachability check survives a level it cannot read", () => {
  // This check runs before the tap, at registration, and it reads levels until it
  // finds a callable one — so a value whose readable levels come *after* a level
  // that throws is a value it has to walk past that throw to answer about, and a
  // `Proxy` is a value whose every read throws. Both are shapes a JavaScript caller
  // can pass, and a throw here fails the declaration rather than refusing a value.
  const partlyUnreadable = {
    error: (): void => {},
  };
  Object.defineProperty(partlyUnreadable, "error", {
    get(): never {
      throw new Error("this level refuses the read");
    },
    configurable: true,
  });

  expect(isRecordableLogger(partlyUnreadable)).toBe(false);
  expect(
    isRecordableLogger(
      new Proxy({} as LoggerService, {
        get(): never {
          throw new Error("this logger refuses the read");
        },
      }),
    ),
  ).toBe(false);

  // The control, so the two answers above are read as a refusal rather than as a
  // check that answers `false` for everything.
  expect(isRecordableLogger({ log: () => {} })).toBe(true);
});

/** Binds the loopback socket on port `0` and reads the address it took. */
function serveLoopback(application: Elysia, logs?: TappedLogStream): DevtoolsServer {
  const server = startDevtoolsServer({
    application,
    port: 0,
    logger: silentLogger,
    ...(logs === undefined ? {} : { logs }),
  });

  if (server === undefined) {
    throw new Error("the devtools server refused to bind the loopback socket");
  }

  return server;
}

async function readLogs(server: DevtoolsServer, query = ""): Promise<AponiaLogsPayload> {
  const response = await fetch(`${server.url}/__devtools/logs${query}`);

  expect(response.status).toBe(200);

  return (await response.json()) as AponiaLogsPayload;
}

test("logs answers the retained window and answers a poll from the cursor it published", async () => {
  const logs = createLogBuffer(4);
  logs.write(entry("one"));
  logs.write(entry("two"));

  const server = serveLoopback(new Elysia(), { buffer: logs, levels: ["log"] });
  try {
    const first = await readLogs(server);

    expect(first.cursor).toBe(2);
    expect(messagesOf(first)).toEqual(["one", "two"]);

    logs.write(entry("three"));

    const second = await readLogs(server, `?since=${first.cursor}`);

    expect(second.cursor).toBe(3);
    expect(messagesOf(second)).toEqual(["three"]);
  } finally {
    server.stop();
  }
});

test("a since beyond the retained window answers what is retained, not an error", async () => {
  const logs = createLogBuffer(4);
  logs.write(entry("one"));

  const server = serveLoopback(new Elysia(), { buffer: logs, levels: ["log"] });
  try {
    const response = await fetch(`${server.url}/__devtools/logs?since=999999`);

    expect(response.status).toBe(200);

    const payload = (await response.json()) as AponiaLogsPayload;

    // Nothing is retained after a cursor that has never been reached, and the
    // cursor that comes back is the stream's own count rather than a rewind to
    // the number the request named.
    expect(payload.entries).toEqual([]);
    expect(payload.cursor).toBe(1);
  } finally {
    server.stop();
  }
});

test("the stream is bounded over the wire at the capacity it was built with", async () => {
  const logs = createLogBuffer(2);
  for (const message of ["one", "two", "three"]) {
    logs.write(entry(message));
  }

  const server = serveLoopback(new Elysia(), { buffer: logs, levels: ["log"] });
  try {
    const payload = await readLogs(server);

    expect(payload.entries).toHaveLength(2);
    expect(messagesOf(payload)).toEqual(["two", "three"]);
    expect(payload.cursor).toBe(3);
  } finally {
    server.stop();
  }
});

test("a since that is not a cursor reads as the whole retained window", async () => {
  const logs = createLogBuffer(4);
  logs.write(entry("one"));

  const server = serveLoopback(new Elysia(), { buffer: logs, levels: ["log"] });
  try {
    // A repeated key reads as its first value, which is what a poller sends when
    // it appends its cursor to a query it built.
    for (const query of [
      "",
      "?since=",
      "?since=later",
      "?since=-1",
      "?since=1.5",
      "?since=0",
      "?since=0&since=99",
    ]) {
      const payload = await readLogs(server, query);

      expect(messagesOf(payload)).toEqual(["one"]);
      expect(payload.cursor).toBe(1);
    }
  } finally {
    server.stop();
  }
});

test("a server that was handed no stream serves no logs endpoint", async () => {
  const server = serveLoopback(new Elysia());
  try {
    const logs = await fetch(`${server.url}/__devtools/logs`);

    // The endpoint states a stream, and this server has none to state: the
    // dispatcher's `404` is the answer for a path its handler record does not
    // own, rather than an empty stream that would claim nothing was logged.
    expect(logs.status).toBe(404);
    expect((await fetch(`${server.url}/__devtools/meta`)).status).toBe(200);
  } finally {
    server.stop();
  }
});

const ephemeralPort = 0;

/** The logger the application and the platform both write to, tapped once. */
const streamedLogger = new Logger("Streamed", { timestamp: false });

@Module({
  imports: [
    DevtoolsModule.register({ enabled: true, port: ephemeralPort, logger: streamedLogger }),
  ],
})
class StreamedModule {}

/**
 * The same logger with one level taken away. `debug` is optional on
 * `LoggerService`, so a logger that does not carry it is an ordinary shape rather
 * than a case invented here, and it is the one way a level is absent from a
 * stream without a refusal having landed: the tap reads no method at that level
 * and moves on. The level is shadowed by an own property set to `undefined`
 * because the concrete logger declares it on its prototype, where a `delete` of
 * an own property could not reach it.
 */
const partlyReachableLogger = new Logger("PartlyReachable", { timestamp: false });
Object.defineProperty(partlyReachableLogger, "debug", {
  value: undefined,
  writable: true,
  configurable: true,
});

@Module({
  imports: [
    DevtoolsModule.register({
      enabled: true,
      port: ephemeralPort,
      logger: partlyReachableLogger,
    }),
  ],
})
class PartlyReachableModule {}

/**
 * A logger that refuses to be **read** at one level: `error`, the third level the
 * tap reaches, is a getter that throws. A live object — a getter, a `Proxy` — can
 * refuse the read as readily as the assignment, and registration reads every level
 * twice: once in `isRecordableLogger`, to decide whether the value is a logger at
 * all, and once in the tap, to take the method. Both reads happen while the module
 * is being **declared**, so a read that escaped would not fail one endpoint; it
 * would fail the declaration itself, and with it every boot of the module that
 * wrote it.
 */
function createUnreadableLevelLogger(): LoggerService {
  const logger: LoggerService = {
    log: () => {},
    fatal: () => {},
    error: () => {},
    warn: () => {},
  };
  Object.defineProperty(logger, "error", {
    get(): never {
      throw new Error("this logger refuses the read");
    },
    configurable: true,
  });

  return logger;
}

const unreadableLevelLogger: LoggerService = createUnreadableLevelLogger();

@Module({
  imports: [
    DevtoolsModule.register({ enabled: true, port: ephemeralPort, logger: unreadableLevelLogger }),
  ],
})
class UnreadableLevelModule {}

@Module({
  imports: [DevtoolsModule.register({ enabled: true, port: ephemeralPort, logger: false })],
})
class DisabledLoggingModule {}

@Module({ imports: [DevtoolsModule.register({ enabled: true, port: ephemeralPort })] })
class PublishedNoLoggerModule {}

/**
 * A registration that names the level array the factory also accepts. A
 * JavaScript caller has no type checker, and this is the shape the option's own
 * JSDoc names: the platform builds a logger of its own for an array of levels, so
 * the application never holds an object this registration could record from.
 */
@Module({
  imports: [
    DevtoolsModule.register({
      enabled: true,
      port: ephemeralPort,
      logger: ["log"] as unknown as LoggerService,
    }),
  ],
})
class LevelArrayModule {}

/**
 * A logger object that exists and cannot be patched. Freezing it is how a real
 * application ends up here: the object is handed over, the tap's assignments all
 * throw, and nothing is installed — the one case where a stream would be empty
 * while the logger behind it prints.
 */
const frozenLogger: LoggerService = Object.freeze({
  log: () => {},
  fatal: () => {},
  error: () => {},
  warn: () => {},
});

@Module({
  imports: [DevtoolsModule.register({ enabled: true, port: ephemeralPort, logger: frozenLogger })],
})
class FrozenLoggerModule {}

/**
 * A logger the tap can partly patch: `log` accepts the assignment and `fatal` —
 * the next level the tap reaches — refuses it. That is the other side of the
 * boundary `frozenLogger` pins: a refusal that lands **after** a level was
 * patched, where the tap genuinely installed and the stream is the answer.
 */
function createPartlyTappableLogger(): LoggerService {
  const logger: LoggerService = {
    log: () => {},
    fatal: () => {},
    error: () => {},
    warn: () => {},
  };
  // Defined non-writable, which is how a logger refuses one assignment and accepts
  // the others: the tap's `log` patch lands and its `fatal` patch is thrown out.
  Object.defineProperty(logger, "fatal", {
    ...Object.getOwnPropertyDescriptor(logger, "fatal"),
    writable: false,
  });

  return logger;
}

const partlyTappableLogger: LoggerService = createPartlyTappableLogger();

@Module({
  imports: [
    DevtoolsModule.register({ enabled: true, port: ephemeralPort, logger: partlyTappableLogger }),
  ],
})
class PartlyTappableModule {}

interface CapturedOutput {
  readonly rows: () => readonly string[];
  readonly restore: () => void;
}

/** Only the `Devtools` report is read back, so Elysia's banner stays out of it. */
function captureOutput(): CapturedOutput {
  const chunks: string[] = [];
  const write = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });

  return {
    rows: () => chunks.join("").split("\n"),
    restore: () => write.mockRestore(),
  };
}

function devtoolsReports(output: CapturedOutput): readonly string[] {
  return output.rows().filter((row) => row.includes("[Devtools]"));
}

/** The loopback address the one report names, read back rather than guessed. */
function reportedAddress(output: CapturedOutput): string {
  const report = devtoolsReports(output)[0] ?? "";
  const address = /http:\/\/127\.0\.0\.1:\d+/.exec(report)?.[0];

  if (address === undefined) {
    throw new Error(`the devtools report named no loopback address: ${report}`);
  }

  return address;
}

async function readLogsAt(address: string, query = ""): Promise<AponiaLogsPayload> {
  const response = await fetch(`${address}/__devtools/logs${query}`);

  expect(response.status).toBe(200);

  return (await response.json()) as AponiaLogsPayload;
}

test.serial(
  "a registration records the lines the boot wrote before its socket started",
  async () => {
    const output = captureOutput();
    let application: AponiaElysiaApplication | undefined;
    try {
      application = await AponiaFactory.create(StreamedModule, { logger: streamedLogger });
      await application.listen(0);

      const first = await readLogsAt(reportedAddress(output));
      const contexts = first.entries.map((item) => item.context);

      // The stream started at registration, which is before the boot wrote
      // anything: a tap installed when the socket starts would answer with none of
      // these, and these are most of what a log stream is worth.
      expect(contexts).toContain("AponiaFactory");
      expect(contexts).toContain("InstanceLoader");
      expect(contexts).toContain("AponiaApplication");
      expect(first.cursor).toBe(first.entries.length);
      // A logger that carries every level is tapped at every one of them, so the
      // payload names the optional `debug` level too: a stream that could only
      // ever reach the four levels a plain object declares would drop it here.
      expect(first.levels).toContain("debug");

      // Cause one more log line, then read from the cursor the previous answer
      // carried: the poll is answered with that line and nothing else.
      streamedLogger.log("after the first poll", "LogsTest");

      const second = await readLogsAt(reportedAddress(output), `?since=${first.cursor}`);

      expect(second.entries.map((item) => item.message)).toEqual(["after the first poll"]);
      expect(second.entries.map((item) => item.context)).toEqual(["LogsTest"]);
      expect(second.cursor).toBe(first.cursor + 1);
    } finally {
      await application?.close();
      output.restore();
    }
  },
);

test.serial("an application that disabled its logging serves no logs endpoint", async () => {
  const output = captureOutput();
  let application: AponiaElysiaApplication | undefined;
  try {
    application = await AponiaFactory.create(DisabledLoggingModule, { logger: false });
    await application.listen(0);

    const address = reportedAddress(output);

    // `false` states that the application has no logger object to hand over, and
    // this registration cannot tell that from the logger the factory built for
    // the application it was not given: an empty window would announce that
    // nothing is being logged, which is false whenever the factory was handed a
    // logger of its own. Absence is the one answer that is true either way.
    expect((await fetch(`${address}/__devtools/logs`)).status).toBe(404);
    expect((await fetch(`${address}/__devtools/meta`)).status).toBe(200);
  } finally {
    await application?.close();
    output.restore();
  }
});

test.serial("a registration that published no logger serves no logs endpoint", async () => {
  const output = captureOutput();
  let application: AponiaElysiaApplication | undefined;
  try {
    application = await AponiaFactory.create(PublishedNoLoggerModule, { logger: false });
    await application.listen(0);

    const address = reportedAddress(output);

    // The endpoint states a stream, and this registration has none to state: the
    // dispatcher's `404` is the answer for a path its handler record does not
    // own, rather than an empty stream that would claim the application logs
    // nothing. The application itself named no logger, so there is no object to
    // record from — the factory built one, and a registration never sees it.
    expect((await fetch(`${address}/__devtools/logs`)).status).toBe(404);
    expect((await fetch(`${address}/__devtools/meta`)).status).toBe(200);
  } finally {
    await application?.close();
    output.restore();
  }
});

test.serial(
  "a registration that named something that is not a logger serves no endpoint",
  async () => {
    const output = captureOutput();
    let application: AponiaElysiaApplication | undefined;
    try {
      application = await AponiaFactory.create(LevelArrayModule, { logger: false });
      await application.listen(0);

      const address = reportedAddress(output);

      // A registration that names a level array has nothing this package can
      // record from, and the endpoint is absent for the same reason it is absent
      // for one that names nothing: an empty stream would claim the application
      // logs nothing while it logs normally.
      expect((await fetch(`${address}/__devtools/logs`)).status).toBe(404);
      expect((await fetch(`${address}/__devtools/meta`)).status).toBe(200);
    } finally {
      await application?.close();
      output.restore();
    }
  },
);

test.serial(
  "a registration whose logger no level could be patched on serves no endpoint",
  async () => {
    const output = captureOutput();
    let application: AponiaElysiaApplication | undefined;
    try {
      application = await AponiaFactory.create(FrozenLoggerModule, { logger: frozenLogger });
      await application.listen(0);

      const address = reportedAddress(output);

      // This registration named a logger object, and it is the one case where a
      // stream would be a lie rather than an absence: the tap installed nothing, so
      // `{ cursor: 0, entries: [] }` would announce that nothing is being logged
      // while the logger keeps printing everything the platform writes to it.
      expect((await fetch(`${address}/__devtools/logs`)).status).toBe(404);
      expect((await fetch(`${address}/__devtools/meta`)).status).toBe(200);
    } finally {
      await application?.close();
      output.restore();
    }
  },
);

test.serial(
  "a registration whose logger refuses one assignment still serves the stream",
  async () => {
    const output = captureOutput();
    let application: AponiaElysiaApplication | undefined;
    try {
      application = await AponiaFactory.create(PartlyTappableModule, {
        logger: partlyTappableLogger,
      });
      await application.listen(0);

      const address = reportedAddress(output);
      const first = await readLogsAt(address);

      // The endpoint is there because a tap genuinely installed: `log` was patched
      // before the refusal landed, so the lines the boot wrote through that level
      // are recorded — the same boot lines the fully tappable case asserts, which is
      // what shows this stream began at registration too.
      expect(first.entries.map((item) => item.context)).toContain("AponiaFactory");

      // The refusal costs one level rather than every level after it: `fatal` was
      // the level it landed on and `warn` is a level the tap reached afterwards, so
      // the stream publishes `warn` and not `fatal`.
      expect(first.levels).toContain("warn");
      expect(first.levels).not.toContain("fatal");

      partlyTappableLogger.log("after the refusal", "LogsTest");

      const second = await readLogsAt(address, `?since=${first.cursor}`);

      expect(second.entries.map((item) => item.message)).toEqual(["after the refusal"]);
      expect(second.entries.map((item) => item.context)).toEqual(["LogsTest"]);
    } finally {
      await application?.close();
      output.restore();
    }
  },
);

test.serial(
  "a stream names the levels the tap reached and leaves out the one it could not",
  async () => {
    const output = captureOutput();
    let application: AponiaElysiaApplication | undefined;
    try {
      application = await AponiaFactory.create(PartlyReachableModule, {
        logger: partlyReachableLogger,
      });
      await application.listen(0);

      const first = await readLogsAt(reportedAddress(output));

      // The boot's own lines are in the stream, so the stream is live and an absent
      // `debug` entry is the tap's business rather than the application's.
      expect(first.entries.map((item) => item.context)).toContain("AponiaFactory");

      // The level the logger does not carry is stated as unreached rather than left
      // to be inferred from an absence in `entries`: without this field a stream that
      // never carries `debug` and one whose `debug` lines were never written would
      // read the same.
      expect(first.levels).toContain("log");
      expect(first.levels).not.toContain("debug");
    } finally {
      await application?.close();
      output.restore();
    }
  },
);

test.serial("a level that refuses the read does not fail the boot", async () => {
  const output = captureOutput();
  let application: AponiaElysiaApplication | undefined;
  try {
    // The declaration above already read every level of this logger, at the moment
    // the module was decorated, and this is the boot that follows: a read that threw
    // out of the registration would have taken the module's declaration with it, so
    // reaching this line at all is half of what the case asserts.
    application = await AponiaFactory.create(UnreadableLevelModule, {
      logger: unreadableLevelLogger,
    });
    await application.listen(0);

    const first = await readLogsAt(reportedAddress(output));

    // The stream is live — the boot wrote through the level that could be read — so
    // the level it refused is a fact about that logger rather than about a tap that
    // never installed.
    expect(first.entries.map((item) => item.context)).toContain("AponiaFactory");

    // The level whose read threw is stated as unreached, and the level after it is
    // named: a read that throws costs the level it landed on rather than that level
    // and every one after it.
    expect(first.levels).toContain("log");
    expect(first.levels).not.toContain("error");
    expect(first.levels).toContain("warn");
  } finally {
    await application?.close();
    output.restore();
  }
});
