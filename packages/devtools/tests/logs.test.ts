import { expect, spyOn, test } from "bun:test";
import { Logger, Module, type LoggerService } from "@aponiajs/common";
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import {
  DevtoolsModule,
  createLogBuffer,
  defaultLogBufferCapacity,
  startDevtoolsServer,
  tapLogBuffer,
  type AponiaLogsPayload,
  type DevtoolsServer,
  type LogEntry,
} from "../src/index.ts";

/**
 * The bounded log stream and the endpoint that publishes it.
 *
 * The stream comes from the boot record: the logger `AponiaFactory.create`
 * decided on is the object `/logs` records, so a case boots a real application
 * and writes through a logger it owns to pin what a client observes. The
 * contract is HTTP and a cursor, so every socket binds port `0` and the address
 * is read back — off the server handle, or out of the `Devtools` report. No case
 * depends on a port it guessed.
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

/** A module with nothing in it: a boot for the sake of its record. */
@Module({})
class EmptyModule {}

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

test("the tap records each line and still writes it through the logger it was given", () => {
  const { logger, calls } = fakeLogger();
  const buffer = createLogBuffer(4);

  const tapped = tapLogBuffer(logger, buffer);

  // The stream that records it is the answer, and the logger is the object the
  // caller already held: the lines written through that reference are the lines
  // this records, which is what patching in place buys and a wrapper could not.
  expect(tapped).toBe(buffer);

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

  expect(tapLogBuffer(logger, first)).toBe(first);
  // A second server started over the same logger — a second `listen()` — is
  // answered with the stream that is already recording, so the lines a client
  // polls and the lines the logger writes cannot drift apart.
  expect(tapLogBuffer(logger, second)).toBe(first);

  logger.log("once");

  expect(calls).toEqual(["log once"]);
  expect(first.since(0).entries).toHaveLength(1);
  expect(second.since(0).entries).toEqual([]);
});

test("a logger this package cannot patch is left as it is and records nothing", () => {
  const { logger, calls } = fakeLogger();
  const buffer = createLogBuffer(4);
  Object.freeze(logger);

  const tapped = tapLogBuffer(logger, buffer);

  expect(tapped).toBe(buffer);

  logger.log("still writes");

  expect(calls).toEqual(["log still writes"]);
  expect(buffer.since(0).entries).toEqual([]);
});

/** Binds the loopback socket on port `0` and reads the address it took. */
function serveLoopback(application: Elysia): DevtoolsServer {
  const server = startDevtoolsServer({ application, port: 0, logger: silentLogger });

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
  const { logger } = fakeLogger();
  const application = await AponiaFactory.createNative(EmptyModule, { logger });
  const server = serveLoopback(application);

  try {
    // Written after the socket started, so the stream holds exactly these: the
    // tap is installed while the server starts, and the boot's own lines are
    // behind it rather than mixed into a window this case asserts by name.
    logger.log("one", "LogsTest");
    logger.log("two", "LogsTest");

    const first = await readLogs(server);

    expect(first.cursor).toBe(2);
    expect(messagesOf(first)).toEqual(["one", "two"]);

    logger.log("three", "LogsTest");

    const second = await readLogs(server, `?since=${first.cursor}`);

    expect(second.cursor).toBe(3);
    expect(messagesOf(second)).toEqual(["three"]);
  } finally {
    server.stop();
  }
});

test("a since beyond the retained window answers what is retained, not an error", async () => {
  const { logger } = fakeLogger();
  const application = await AponiaFactory.createNative(EmptyModule, { logger });
  const server = serveLoopback(application);

  try {
    logger.log("one", "LogsTest");

    const response = await fetch(`${server.url}/__devtools/logs?since=999999`);

    expect(response.status).toBe(200);

    const payload = (await response.json()) as AponiaLogsPayload;

    // Nothing is retained after a cursor that has never been reached, and the
    // cursor that comes back is the stream's own count rather than a rewind to
    // the number the request named.
    expect(payload.entries).toEqual([]);
    expect(payload.cursor).toBeLessThanOrEqual(999999);
    expect(payload.cursor).toBe(1);
  } finally {
    server.stop();
  }
});

test("the stream is bounded over the wire at the capacity it was built with", async () => {
  const { logger } = fakeLogger();
  const application = await AponiaFactory.createNative(EmptyModule, { logger });
  const server = serveLoopback(application);

  try {
    // Two lines more than the bound holds, so what is retained is a suffix of
    // what was written and the two oldest are the ones gone.
    const written = defaultLogBufferCapacity + 2;
    for (let index = 1; index <= written; index += 1) {
      logger.log(`line-${index}`, "LogsTest");
    }

    const payload = await readLogs(server);

    expect(payload.entries).toHaveLength(defaultLogBufferCapacity);
    expect(payload.cursor).toBe(written);
    expect(payload.entries[0]?.message).toBe(`line-${written - defaultLogBufferCapacity + 1}`);
    expect(payload.entries.at(-1)?.message).toBe(`line-${written}`);
  } finally {
    server.stop();
  }
});

test("a since that is not a cursor reads as the whole retained window", async () => {
  const { logger } = fakeLogger();
  const application = await AponiaFactory.createNative(EmptyModule, { logger });
  const server = serveLoopback(application);

  try {
    logger.log("one", "LogsTest");

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

test("a server whose application carries no boot record serves no logs endpoint", async () => {
  const server = serveLoopback(new Elysia());

  try {
    const logs = await fetch(`${server.url}/__devtools/logs`);

    // The endpoint states a stream, and an application no boot produced has no
    // logger to state: the dispatcher's `404` is the answer for a path its
    // handler record does not own, rather than an empty stream that would claim
    // nothing was logged.
    expect(logs.status).toBe(404);
    expect((await fetch(`${server.url}/__devtools/meta`)).status).toBe(200);
  } finally {
    server.stop();
  }
});

test("a record written before the boot published a logger serves no logs endpoint", async () => {
  // The record is read through a registry-global symbol key, so a boot run by an
  // older copy of `@aponiajs/platform-elysia` in this process is reachable from
  // here — and that copy's record has no `logger` at all. This attaches the
  // record the way an older bootstrap did: a missing field is "no statement",
  // which is a different thing from `null`, the decision not to log.
  const application = new Elysia();
  Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
    value: { framework: "0.0.0-older", graph: "decorated" },
    enumerable: false,
  });
  const server = serveLoopback(application);

  try {
    expect((await fetch(`${server.url}/__devtools/logs`)).status).toBe(404);
    expect((await fetch(`${server.url}/__devtools/meta`)).status).toBe(200);
  } finally {
    server.stop();
  }
});

test("a record whose logger is not a logger serves no logs endpoint", async () => {
  for (const logger of ["nope", {}, { log: "not a function" }]) {
    const application = new Elysia();
    Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
      value: { framework: "9.9.9-newer", logger },
      enumerable: false,
    });
    const server = serveLoopback(application);

    try {
      // A foreign record may hold anything, and a logger with no callable level
      // records nothing: an endpoint answering an empty stream would claim the
      // application logs nothing while it logs normally, so the path is not
      // served at all.
      expect((await fetch(`${server.url}/__devtools/logs`)).status).toBe(404);
    } finally {
      server.stop();
    }
  }
});

const ephemeralPort = 0;

/**
 * One registration for the cases that need a real boot. Which logger the
 * application logs through is the factory's decision in every one of them, and
 * the case that owns a logger passes it there.
 */
@Module({
  imports: [DevtoolsModule.register({ enabled: true, port: ephemeralPort })],
})
class LoggedModule {}

/** The logger one case hands the factory, so its own lines are the ones it asserts. */
const streamedLogger = new Logger("Streamed", { timestamp: false });

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

test.serial("an application that named no logger streams what it logs", async () => {
  const output = captureOutput();
  let application: AponiaElysiaApplication | undefined;
  try {
    // No `logger` option at all: the default path, and the one a registration
    // could not have covered with a logger of its own. The record names the
    // logger the boot built, so the lines the application writes through it are
    // the lines the stream states.
    application = await AponiaFactory.create(LoggedModule);
    await application.listen(0);

    const first = await readLogsAt(reportedAddress(output));
    const contexts = first.entries.map((item) => item.context);

    expect(contexts).toContain("AponiaApplication");
    expect(first.cursor).toBe(first.entries.length);
    expect(first.cursor).toBeGreaterThan(0);

    // The stream begins when the socket starts, because that is when the server
    // reads the record and installs the tap: the lines the boot wrote about
    // itself are behind it. Those are the only lines a stream of the
    // application's own logger cannot hold, and it holds every one written after.
    expect(contexts).not.toContain("InstanceLoader");
    expect(contexts).not.toContain("AponiaFactory");
  } finally {
    await application?.close();
    output.restore();
  }
});

test.serial("an application that named a list of levels streams what it logs", async () => {
  const output = captureOutput();
  let application: AponiaElysiaApplication | undefined;
  try {
    // The other value the factory accepts that is not a logger: the platform
    // builds one, and the record is still where it can be read, so the
    // application logs normally and the stream is not silently empty.
    application = await AponiaFactory.create(LoggedModule, { logger: ["log"] });
    await application.listen(0);

    const payload = await readLogsAt(reportedAddress(output));

    expect(payload.cursor).toBeGreaterThan(0);
    expect(payload.entries.map((item) => item.context)).toContain("AponiaApplication");
  } finally {
    await application?.close();
    output.restore();
  }
});

test.serial(
  "the application's own line arrives after the cursor the last answer named",
  async () => {
    const output = captureOutput();
    let application: AponiaElysiaApplication | undefined;
    try {
      // A logger the application supplied and still holds: the tap patches this
      // object, so the line written through the case's own reference is a line the
      // stream states — which a wrapper could not promise.
      application = await AponiaFactory.create(LoggedModule, { logger: streamedLogger });
      await application.listen(0);

      const first = await readLogsAt(reportedAddress(output));

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

test.serial("an application that disabled its logging serves an empty stream", async () => {
  const output = captureOutput();
  let application: AponiaElysiaApplication | undefined;
  try {
    application = await AponiaFactory.create(LoggedModule, { logger: false });
    await application.listen(0);

    // `false` is a decision, not an absence: the endpoint answers, and what it
    // answers is that nothing is being logged.
    expect(await readLogsAt(reportedAddress(output))).toEqual({ cursor: 0, entries: [] });
  } finally {
    await application?.close();
    output.restore();
  }
});
