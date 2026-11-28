import { expect, test } from "bun:test";
import { Logger, type LoggerService } from "@aponiajs/common";
import { Elysia } from "elysia";
// The reachability check the tap is reached through, imported from its own module
// because it is marked `@internal` and deliberately kept off the barrel for this
// package's cases — the same arrangement `createHandlers` has in `server.test.ts`.
import { isRecordableLogger } from "../logging/log-tap.ts";
import {
  createLogBuffer,
  devtoolsPathPrefix,
  handleDevtoolsRequest,
  recordLogger,
  type AponiaLogsPayload,
  type LogEntry,
  type LogStream,
} from "../index.ts";
// The handler record the mounted route answers through, from the module that owns
// it rather than the barrel: the surface is a route an application mounts, and
// this is the pair that route calls.
import { handlersOf } from "../../test/support/boot.ts";

/**
 * The bounded log stream and the endpoint that publishes it.
 *
 * The stream comes from the registration: the logger an application hands
 * `DevtoolsModule.register` is the object `/logs` records — the same one it hands
 * the factory — so a case boots a real application and writes through the logger
 * it owns to pin what a client observes. The contract is HTTP and a cursor, so
 * every case asks the pair the mounted route calls in process, and the payload
 * assertions are the wire shape. The mount itself is pinned over
 * `application.handle` in `devtools-module.test.ts`, and the dispatcher's `404`
 * and `405` in `server.test.ts`.
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

  const tapped = recordLogger(logger, buffer);

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
  recordLogger(logger, buffer);

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
  recordLogger(logger, buffer);

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
  recordLogger(logger, buffer);

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

  expect(recordLogger(logger, first)?.buffer).toBe(first);
  // A second registration naming the same logger is answered with the stream that
  // is already recording, so the lines a client polls and the lines the logger
  // writes cannot drift apart.
  expect(recordLogger(logger, second)?.buffer).toBe(first);

  logger.log("once");

  expect(calls).toEqual(["log once"]);
  expect(first.since(0).entries).toHaveLength(1);
  expect(second.since(0).entries).toEqual([]);
});

test("a logger no level could be patched on is answered with no stream, not an empty one", () => {
  const { logger, calls } = fakeLogger();
  const buffer = createLogBuffer(4);
  Object.freeze(logger);

  const tapped = recordLogger(logger, buffer);

  // Nothing was installed, so the buffer will never hold a line: handing it back
  // would be an empty stream published over a logger that goes on printing, which
  // is the false silence this package refuses everywhere else.
  expect(tapped).toBeUndefined();

  logger.log("still writes");

  expect(calls).toEqual(["log still writes"]);
  expect(buffer.since(0).entries).toEqual([]);
  // A logger nothing could be installed on is not remembered as one that has a
  // stream, so a later tap retries and answers the same absence.
  expect(recordLogger(logger, buffer)).toBeUndefined();
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

  const tapped = recordLogger(logger, buffer);

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

  const tapped = recordLogger(logger, buffer);

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

  const tapped = recordLogger(logger, createLogBuffer(4));

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

  const tapped = recordLogger(logger, createLogBuffer(4));

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
  const tapped = recordLogger(logger, buffer);

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

  expect(recordLogger(logger, createLogBuffer(4))).toBeUndefined();
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

/** One devtools path answered for one application, with the stream it publishes. */
async function ask(application: Elysia, path: string, logs?: LogStream): Promise<Response> {
  return await handleDevtoolsRequest(
    new Request(`http://localhost${devtoolsPathPrefix}${path}`),
    handlersOf(application, logs, undefined, silentLogger),
  );
}

async function readLogs(
  application: Elysia,
  query = "",
  logs?: LogStream,
): Promise<AponiaLogsPayload> {
  const response = await ask(application, `/logs${query}`, logs);

  expect(response.status).toBe(200);

  return (await response.json()) as AponiaLogsPayload;
}

test("logs answers the retained window and answers a poll from the cursor it published", async () => {
  const logs = createLogBuffer(4);
  logs.write(entry("one"));
  logs.write(entry("two"));

  const application = new Elysia();
  const stream: LogStream = { buffer: logs, levels: ["log"] };
  const first = await readLogs(application, "", stream);

  expect(first.cursor).toBe(2);
  expect(messagesOf(first)).toEqual(["one", "two"]);

  logs.write(entry("three"));

  const second = await readLogs(application, `?since=${first.cursor}`, stream);

  expect(second.cursor).toBe(3);
  expect(messagesOf(second)).toEqual(["three"]);
});

test("a since beyond the retained window answers what is retained, not an error", async () => {
  const logs = createLogBuffer(4);
  logs.write(entry("one"));

  const payload = await readLogs(new Elysia(), "?since=999999", {
    buffer: logs,
    levels: ["log"],
  });

  // Nothing is retained after a cursor that has never been reached, and the
  // cursor that comes back is the stream's own count rather than a rewind to
  // the number the request named.
  expect(payload.entries).toEqual([]);
  expect(payload.cursor).toBe(1);
});

test("the stream is bounded over the wire at the capacity it was built with", async () => {
  const logs = createLogBuffer(2);
  for (const message of ["one", "two", "three"]) {
    logs.write(entry(message));
  }

  const payload = await readLogs(new Elysia(), "", { buffer: logs, levels: ["log"] });

  expect(payload.entries).toHaveLength(2);
  expect(messagesOf(payload)).toEqual(["two", "three"]);
  expect(payload.cursor).toBe(3);
});

test("a since that is not a cursor reads as the whole retained window", async () => {
  const logs = createLogBuffer(4);
  logs.write(entry("one"));

  const application = new Elysia();
  const stream: LogStream = { buffer: logs, levels: ["log"] };

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
    const payload = await readLogs(application, query, stream);

    expect(messagesOf(payload)).toEqual(["one"]);
    expect(payload.cursor).toBe(1);
  }
});
