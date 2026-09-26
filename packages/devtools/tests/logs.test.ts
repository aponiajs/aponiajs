import { expect, spyOn, test } from "bun:test";
import { Logger, Module, type LoggerService } from "@aponiajs/common";
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import {
  DevtoolsModule,
  createLogBuffer,
  startDevtoolsServer,
  tapLogBuffer,
  type AponiaLogsPayload,
  type DevtoolsServer,
  type LogBuffer,
  type LogEntry,
} from "../src/index.ts";

/**
 * The bounded log stream and the endpoint that publishes it.
 *
 * The contract is HTTP and a cursor, so the socket lane binds port `0` and reads
 * the address it took back out of the server handle, and the cases that need an
 * application boot read it back out of the `Devtools` report. No case depends on
 * a port it guessed.
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

  // The object, not a wrapper: the application and the platform hold their own
  // references to it, so the lines they write are the lines this records.
  expect(tapped).toBe(logger);

  tapped.log("serving", "RouterExplorer");
  tapped.warn("slow", "HealthController");

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

test("a logger is tapped once, so a line cannot be recorded or printed twice", () => {
  const { logger, calls } = fakeLogger();
  const first = createLogBuffer(4);
  const second = createLogBuffer(4);

  tapLogBuffer(logger, first);
  tapLogBuffer(logger, second);

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

  expect(tapped).toBe(logger);

  tapped.log("still writes");

  expect(calls).toEqual(["log still writes"]);
  expect(buffer.since(0).entries).toEqual([]);
});

/** Binds the loopback socket on port `0` and reads the address it took. */
function serveLoopback(application: Elysia, logs?: LogBuffer): DevtoolsServer {
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

  const server = serveLoopback(new Elysia(), logs);
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

  const server = serveLoopback(new Elysia(), logs);
  try {
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
  const logs = createLogBuffer(2);
  for (const message of ["one", "two", "three"]) {
    logs.write(entry(message));
  }

  const server = serveLoopback(new Elysia(), logs);
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

  const server = serveLoopback(new Elysia(), logs);
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

@Module({
  imports: [DevtoolsModule.register({ enabled: true, port: ephemeralPort, logger: false })],
})
class DisabledLoggingModule {}

@Module({ imports: [DevtoolsModule.register({ enabled: true, port: ephemeralPort })] })
class PublishedNoLoggerModule {}

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

test.serial("an application that disabled its logging serves an empty stream", async () => {
  const output = captureOutput();
  let application: AponiaElysiaApplication | undefined;
  try {
    application = await AponiaFactory.create(DisabledLoggingModule, { logger: false });
    await application.listen(0);

    // `false` is a decision, not an absence: the endpoint answers, and what it
    // answers is that nothing is being logged.
    expect(await readLogsAt(reportedAddress(output))).toEqual({ cursor: 0, entries: [] });
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

    expect((await fetch(`${address}/__devtools/logs`)).status).toBe(404);
    expect((await fetch(`${address}/__devtools/meta`)).status).toBe(200);
  } finally {
    await application?.close();
    output.restore();
  }
});
