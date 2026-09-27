import { expect, spyOn, test } from "bun:test";
import {
  Body,
  Controller,
  Get,
  Logger,
  Module,
  Post,
  Status,
  type LoggerService,
} from "@aponiajs/common";
import {
  AponiaFactory,
  ElysiaPluginModule,
  type AponiaElysiaApplication,
  type ElysiaStatus,
  httpErrors,
} from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import {
  DevtoolsModule,
  createRequestBuffer,
  type AponiaLogsPayload,
  type AponiaRequestsPayload,
  type AponiaRoutesPayload,
  type RequestRecord,
} from "../src/index.ts";

/**
 * Every case here boots one application with the module registered and reads the
 * record back over the devtools socket the plugin started. Every socket binds
 * port `0` and the address is read back out of the boot's own report, so no case
 * depends on a port it guessed.
 */

test("the buffer keeps its capacity and its cursor never goes backwards", () => {
  const buffer = createRequestBuffer(2);
  const entry = (url: string): RequestRecord => ({
    id: 1,
    method: "GET",
    path: url,
    url,
    status: 200,
    durationMs: 1,
    timestamp: "2026-09-26T00:00:00.000Z",
  });

  buffer.write(entry("/one"));
  buffer.write(entry("/two"));
  buffer.write(entry("/three"));

  // The oldest past capacity is gone, and the cursor counts what was written.
  expect(buffer.since(0).entries.map((record) => record.url)).toEqual(["/two", "/three"]);
  expect(buffer.since(0).cursor).toBe(3);

  // A cursor beyond the write count returns nothing rather than an error.
  expect(buffer.since(999).entries).toEqual([]);
  expect(buffer.since(999).cursor).toBe(3);
});

@Controller("/users")
class UsersController {
  @Get("/:id")
  find(): { id: string } {
    return { id: "42" };
  }

  @Post()
  create(@Body() body: unknown, @Status() status: ElysiaStatus): unknown {
    return status(201, { created: body });
  }
}

/**
 * A thrown value the rendering cannot state.
 *
 * It refers to itself, so `JSON.stringify` refuses it, and it refuses the plain
 * string form as well — which is what puts it below both fallbacks, at the
 * literal `@aponiajs/common`'s `renderLogValue` states such a value as. That
 * literal is the one thing the rendering shares with the console logger below its
 * own branches, and it is the one both surfaces report, so this is the value that
 * says whether either of them can throw.
 */
function unrenderableRefusal(): Record<string, unknown> {
  const refusal: Record<string, unknown> = {};
  refusal.self = refusal;
  Object.defineProperty(refusal, Symbol.toPrimitive, {
    value: () => {
      throw new TypeError("this value cannot be stated");
    },
  });

  return refusal;
}

/**
 * A thrown function that cannot be named.
 *
 * The other fixture refuses at the JSON form and at the plain string form, which
 * are the two reads a rendering states out loud. This one refuses at the read the
 * rendering makes of the value itself — the property a function is named by,
 * declared here as a getter that throws — which is the read a rendering guarded
 * around only the pair it thought of would leave bare. It is a function rather
 * than a `Proxy` on purpose: the platform's mapping decides whether Elysia
 * answers an exception before any rendering runs, and that decision walks the
 * value's prototype chain, so a `Proxy` whose `getPrototypeOf` throws never
 * reaches a rendering at all.
 */
function trapRefusingRefusal(): () => never {
  const refusal = function refusingRefusal(): never {
    throw new Error("never reached: the throw above is the failure under test");
  };
  Object.defineProperty(refusal, "name", {
    get() {
      throw new TypeError("this value refuses to be named");
    },
  });

  return refusal;
}

@Controller()
class AnswersController {
  @Get("/explodes")
  explode(): never {
    // An application's own failure, with the message it published.
    throw httpErrors.internalServerError("The database is unreachable.");
  }

  @Get("/unhandled")
  unhandled(): never {
    throw new Error("the raw exception");
  }

  @Get("/unhandled-object")
  unhandledObject(): never {
    // A thrown value that is not an `Error`, so the rendering both surfaces call
    // has to answer it in the same form on both.
    throw { code: "E_CONN", retries: 3 };
  }

  @Get("/unrenderable")
  unrenderable(): never {
    // The value below the rendering's fallback: the shape that reaches the
    // literal, and so the shape that says whether it can throw.
    throw unrenderableRefusal();
  }

  @Get("/trap-refusal")
  trapRefusal(): never {
    // The shape that refuses a read the rendering makes before either fallback:
    // naming it.
    throw trapRefusingRefusal();
  }

  @Get("/own")
  own(): Response {
    // A handler answering through its own `Response`: the status is the one it
    // carries, not the one `set.status` still reads.
    return new Response("own", { status: 201 });
  }

  @Get("/own-failure")
  ownFailure(): Response {
    return new Response(JSON.stringify({ title: "Service Unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}

const ephemeralPort = 0;

@Module({
  imports: [DevtoolsModule.register({ enabled: true, port: ephemeralPort })],
  controllers: [UsersController, AnswersController],
})
class CapturedModule {}

/**
 * The same fixtures under a second registration.
 *
 * A registration is what owns a record, and the module a class was decorated
 * with is what boots reuse: two `listen()`s share one registration, while the
 * two registrations these classes declare own one window each — which is the
 * pair the case below pins.
 */
@Module({
  imports: [DevtoolsModule.register({ enabled: true, port: ephemeralPort })],
  controllers: [UsersController, AnswersController],
})
class CapturedTwinModule {}

/**
 * A gate the out-of-order case opens, so the order two answers land in is that
 * case's decision rather than the clock's: the slow route parks here until it is
 * released.
 */
let openSlowGate: (() => void) | undefined;

/**
 * Two routes whose answers land in the order opposite to their arrivals.
 *
 * The slow route parks until the case releases it, which is what makes an
 * entry's position in the window say nothing about the request it answers — the
 * property that makes "group by `id` and take the last entry" necessary rather
 * than incidental to a window that happened to be written in id order.
 */
@Controller("/delays")
class DelayedController {
  @Get("/slow")
  async slow(): Promise<string> {
    await new Promise<void>((resolve) => {
      openSlowGate = resolve;
    });

    return "slow";
  }

  @Get("/fast")
  fast(): string {
    return "fast";
  }
}

@Module({
  imports: [DevtoolsModule.register({ enabled: true, port: ephemeralPort })],
  controllers: [DelayedController],
})
class OutOfOrderModule {}

@Module({
  imports: [DevtoolsModule.register({ enabled: true, port: ephemeralPort, capture: false })],
  controllers: [UsersController],
})
class UncapturedModule {}

@Module({
  imports: [
    DevtoolsModule.register({
      enabled: true,
      port: ephemeralPort,
      capture: { headers: false, body: false },
    }),
  ],
  controllers: [UsersController],
})
class SparseModule {}

@Module({
  imports: [
    DevtoolsModule.register({ enabled: true, port: ephemeralPort, capture: { bodyLimit: 16 } }),
  ],
  controllers: [UsersController],
})
class LimitedBodyModule {}

@Module({
  imports: [
    DevtoolsModule.register({
      enabled: true,
      port: ephemeralPort,
      capture: { redact: ["Authorization"] },
    }),
  ],
  controllers: [UsersController],
})
class RedactingModule {}

/**
 * A validation model whose transform yields a `BigInt`, so the body the record
 * is handed is one `JSON.stringify` refuses. The wire carries ordinary JSON — the
 * unserializable value is made by the application's own validation, which is what
 * makes it a body a real application can reach rather than one a test invented.
 */
const bigintBody = {
  "~standard": {
    version: 1 as const,
    vendor: "aponia-devtools-test",
    validate: () => ({ value: { id: BigInt(7) } }),
  },
};

@Controller("/bigint")
class UnserializableController {
  @Post("/", { body: bigintBody })
  create(): { created: true } {
    return { created: true };
  }
}

@Module({
  imports: [DevtoolsModule.register({ enabled: true, port: ephemeralPort })],
  controllers: [UnserializableController],
})
class UnserializableModule {}

/**
 * A validation model whose transform yields a body large enough that this
 * package's own serialization of it costs more than the route does, and which
 * states when that serializer reaches it. The `filler` accessor is read when
 * something enumerates the parsed body, and the only thing in this window that
 * does is the record's own `JSON.stringify` — the route reads no body and
 * answers with none. The wire carries ordinary JSON: the large body is made by
 * the application's own validation, which is what makes it a body a real
 * application can reach rather than one a test invented.
 */
let bulkBodyRead = false;
const bulkBody = {
  "~standard": {
    version: 1 as const,
    vendor: "aponia-devtools-test",
    validate: () => ({
      value: {
        get filler(): string {
          bulkBodyRead = true;

          return "x".repeat(400_000);
        },
      },
    }),
  },
};

@Controller("/bulk")
class BulkController {
  @Post("/", { body: bulkBody })
  create(): { created: true } {
    // The route answers at once and reads no body, so everything the record
    // reports beyond a small floor is this package's own read of the body it
    // stored rather than time the application spent on the route.
    return { created: true };
  }
}

@Module({
  imports: [DevtoolsModule.register({ enabled: true, port: ephemeralPort })],
  controllers: [BulkController],
})
class BulkModule {}

/**
 * A plugin that refuses two different ways, because the record's boundary
 * between them is a fact about the installed Elysia rather than a preference.
 */
const gatePlugin = new Elysia({ name: "gate" }).onRequest((context) => {
  const { pathname } = new URL(context.request.url);

  if (pathname === "/gated") {
    throw httpErrors.forbidden("Not yours.");
  }

  if (pathname === "/early-refusal") {
    return new Response("refused", { status: 403 });
  }

  return undefined;
});

@Module({
  imports: [
    DevtoolsModule.register({ enabled: true, port: ephemeralPort }),
    ElysiaPluginModule.register(gatePlugin, { key: "gate" }),
  ],
  controllers: [UsersController],
})
class GatedModule {}

/**
 * The one registration a case reads a log stream out of, because the two
 * endpoints that report an exception have to be compared rather than assumed to
 * agree: `error` on the request record is the same string `/logs` states for the
 * exception the platform mapped. The logger is the one object both halves see —
 * this registration's and the factory's — which is what makes the comparison
 * possible at all.
 */
const agreeingLogger = new Logger("Agreeing", { timestamp: false });

@Module({
  imports: [
    DevtoolsModule.register({ enabled: true, port: ephemeralPort, logger: agreeingLogger }),
  ],
  controllers: [AnswersController],
})
class LoggedFailureModule {}

/**
 * A logger that writes nothing, for the case that has to isolate the rendering.
 *
 * A boot reports a failure through the logger it was handed, and this package's
 * tap records the line before handing the call on, so a logger double keeps the
 * case about the rendering: the failure is reported through it, the tap states
 * the value, and nothing below the tap reads the value a second time.
 */
const silentFailureLogger: LoggerService = {
  log: () => {},
  fatal: () => {},
  error: () => {},
  warn: () => {},
};

@Module({
  imports: [
    DevtoolsModule.register({ enabled: true, port: ephemeralPort, logger: silentFailureLogger }),
  ],
  controllers: [AnswersController],
})
class SilentFailureModule {}

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

/** Every loopback address the boot reported, in the order the rows were written. */
function reportedAddresses(output: CapturedOutput): readonly string[] {
  return output
    .rows()
    .filter((row) => row.includes("[Devtools]"))
    .map((row) => /http:\/\/127\.0\.0\.1:\d+/.exec(row)?.[0])
    .filter((address): address is string => address !== undefined);
}

/** The loopback address the one report names, read back rather than guessed. */
function reportedAddress(output: CapturedOutput): string {
  const [address] = reportedAddresses(output);

  if (address === undefined) {
    throw new Error(`the devtools report named no loopback address: ${output.rows().join("\n")}`);
  }

  return address;
}

type DevtoolsRootModule = Parameters<typeof AponiaFactory.create>[0];

interface BootedApplication {
  readonly application: AponiaElysiaApplication;
  /** The devtools address, which is the socket the record is read over. */
  readonly address: string;
}

async function bootApplication(rootModule: DevtoolsRootModule): Promise<BootedApplication> {
  return bootWithLogger(rootModule, false);
}

/**
 * A boot whose factory and devtools registration share one logger, which is what
 * makes a case able to compare the line `/logs` states for a failure with what the
 * record states about it. `bootApplication` is this with the logger turned off.
 */
async function bootWithLogger(
  rootModule: DevtoolsRootModule,
  logger: LoggerService | false,
): Promise<BootedApplication> {
  const output = captureOutput();
  try {
    const application = await AponiaFactory.create(rootModule, { logger });
    await application.listen(0);

    return { application, address: reportedAddress(output) };
  } finally {
    output.restore();
  }
}

async function readRequests(address: string, query = ""): Promise<AponiaRequestsPayload> {
  const response = await fetch(`${address}/__devtools/requests${query}`);

  // The endpoint answers whether or not anything was recorded: a registration
  // that captures nothing serves an empty record rather than no record.
  expect(response.status).toBe(200);

  return (await response.json()) as AponiaRequestsPayload;
}

/**
 * The one answered entry a case is about, with the whole window in the failure
 * message.
 *
 * One request leaves two entries — one when it arrived and one when it was
 * answered — so a case that reads a field only an answer wrote has to name which
 * half it is about. This is the answered half, and it refuses to guess when the
 * window holds none or several: the pending entries carry `null` for both
 * `status` and `durationMs`, which is what tells the two apart on the wire.
 */
function answeredEntry(payload: AponiaRequestsPayload): RequestRecord {
  const answered = payload.entries.filter((record) => record.status !== null);
  const [entry] = answered;

  if (entry === undefined || answered.length > 1) {
    throw new Error(
      `the record does not hold exactly one answered entry: ${JSON.stringify(payload.entries)}`,
    );
  }

  return entry;
}

/**
 * The answered entry a case is about, found by a field rather than by position.
 *
 * The search skips every pending entry, because the pending entry of a request
 * shares its `url` and `method` with the answer that supersedes it: a case
 * matching on one of those would otherwise be handed the entry written at
 * arrival and read `null` where it expects an answer.
 */
function findAnsweredEntry(
  payload: AponiaRequestsPayload,
  match: (record: RequestRecord) => boolean,
): RequestRecord {
  const entry = payload.entries.find((record) => record.status !== null && match(record));

  if (entry === undefined) {
    throw new Error(`the record holds no such entry: ${JSON.stringify(payload.entries)}`);
  }

  return entry;
}

test.serial("an entry reports the route pattern and the URL that arrived", async () => {
  const { application, address } = await bootApplication(CapturedModule);
  try {
    await fetch(`${application.getUrl()}/users/42?expand=true`, {
      headers: { "x-trace-id": "abc" },
    });

    const payload = await readRequests(address);
    const entry = findAnsweredEntry(payload, (record) => record.path === "/users/:id");

    expect(entry.method).toBe("GET");
    expect(entry.url).toBe("/users/42?expand=true");
    expect(entry.status).toBe(200);
    expect(typeof entry.durationMs).toBe("number");
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
    expect(entry.headers?.["x-trace-id"]).toBe("abc");
    // The route parses no body, so the record carries none.
    expect(Object.hasOwn(entry, "body")).toBe(false);
  } finally {
    await application.close();
  }
});

test.serial("a request that matched no route is recorded without a route identity", async () => {
  const { application, address } = await bootApplication(CapturedModule);
  try {
    await fetch(`${application.getUrl()}/nope?x=1`);

    const payload = await readRequests(address);
    const entry = findAnsweredEntry(payload, (record) => record.url === "/nope?x=1");
    const routes = (await (
      await fetch(`${address}/__devtools/routes`)
    ).json()) as AponiaRoutesPayload;

    expect(entry.status).toBe(404);
    expect(entry.path).toBe("/nope");
    // The path that arrived is not a pattern the table serves.
    expect(routes.routes.some((route) => route.path === entry.path)).toBe(false);
    // An answer rather than a failure: nothing is read off the exception.
    expect(Object.hasOwn(entry, "error")).toBe(false);
  } finally {
    await application.close();
  }
});

test.serial(
  "a request a plugin refuses before it matches is recorded with the path that arrived",
  async () => {
    const { application, address } = await bootApplication(GatedModule);
    try {
      await fetch(`${application.getUrl()}/gated`);

      const payload = await readRequests(address);
      const refused = findAnsweredEntry(payload, (record) => record.url === "/gated");

      expect(refused.status).toBe(403);
      expect(refused.path).toBe("/gated");
      // A `4xx` is an answer rather than a failure.
      expect(Object.hasOwn(refused, "error")).toBe(false);
    } finally {
      await application.close();
    }
  },
);

test.serial(
  "a request a plugin answers with an early response is recorded as unanswered",
  async () => {
    const { application, address } = await bootApplication(GatedModule);
    try {
      await fetch(`${application.getUrl()}/early-refusal`);

      const payload = await readRequests(address);

      // This plugin's arrival hook rides the request phase, which Elysia merges
      // in mount order, so it ran before the plugin that answered: the request
      // is in the record. Nothing ran after that answer — not the after-response
      // hook of this registration, and not the request phase of a plugin mounted
      // after the one that answered — so the entry is the one written at
      // arrival, and its `null` status is this package stating that no answer
      // was observed rather than inventing one.
      expect(payload.cursor).toBe(1);
      expect(payload.entries.map((record) => record.url)).toEqual(["/early-refusal"]);
      expect(payload.entries[0].status).toBeNull();
      expect(payload.entries[0].durationMs).toBeNull();
    } finally {
      await application.close();
    }
  },
);

test.serial(
  "an answered request carries one id across a pending entry and its answer",
  async () => {
    const { application, address } = await bootApplication(CapturedModule);
    try {
      await fetch(`${application.getUrl()}/users/42`);

      const payload = await readRequests(address);

      // One request writes two entries, and they are one request's because they
      // share an id: a consumer that groups by it reads the answer and never the
      // pending entry it supersedes.
      expect(payload.cursor).toBe(2);
      expect(payload.entries).toHaveLength(2);

      const [pending, answered] = payload.entries;

      expect(pending.id).toBe(answered.id);
      expect(pending.url).toBe(answered.url);
      expect(pending.status).toBeNull();
      expect(pending.durationMs).toBeNull();
      // The answer states the route it matched, which no arrival can know yet.
      expect(pending.path).toBe("/users/42");
      expect(answered.path).toBe("/users/:id");
      expect(answered.status).toBe(200);
      expect(answered.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await application.close();
    }
  },
);

test.serial(
  "a poll whose cursor sits between a request's two entries is served the answer",
  async () => {
    const { application, address } = await bootApplication(CapturedModule);
    try {
      await fetch(`${application.getUrl()}/users/42`);

      const whole = await readRequests(address);
      expect(whole.entries).toHaveLength(2);

      // The cursor a poller would hold after reading the pending entry and nothing
      // after it. The answer was written next, so this read is the superseding
      // entry — which is the property that makes grouping by `id` work: a poller
      // is never stuck holding the pending shape.
      const between = await readRequests(address, `?since=${whole.cursor - 1}`);

      expect(between.cursor).toBe(whole.cursor);
      expect(between.entries).toHaveLength(1);
      expect(between.entries[0].id).toBe(whole.entries[0].id);
      expect(between.entries[0].status).toBe(200);
    } finally {
      await application.close();
    }
  },
);

test.serial("the last entry per id is the answer when answers land out of id order", async () => {
  const { application, address } = await bootApplication(OutOfOrderModule);
  try {
    // The slow request arrives first, so it takes the lower id, and it parks
    // until this case releases it. The fast request arrives second and answers
    // first, so the two answers land in the order opposite to the two arrivals.
    const slow = fetch(`${application.getUrl()}/delays/slow`);
    for (let attempt = 0; attempt < 200 && openSlowGate === undefined; attempt += 1) {
      await Bun.sleep(5);
    }

    const release = openSlowGate;

    if (release === undefined) {
      throw new Error("the slow route never parked, so it could not be released");
    }

    await fetch(`${application.getUrl()}/delays/fast`);
    release();
    await slow;

    const payload = await readRequests(address);

    // Two arrivals and two answers, and the position of each in the window says
    // nothing about the request it answers: the `id` they share is the only
    // thing that pairs them.
    expect(payload.entries.map((record) => record.url)).toEqual([
      "/delays/slow",
      "/delays/fast",
      "/delays/fast",
      "/delays/slow",
    ]);

    const grouped = new Map<number, readonly RequestRecord[]>();
    for (const record of payload.entries) {
      grouped.set(record.id, [...(grouped.get(record.id) ?? []), record]);
    }

    expect(grouped.size).toBe(2);

    for (const entries of grouped.values()) {
      // Each group is one request: the entry written at arrival states no answer,
      // and the one written at completion supersedes it.
      expect(entries).toHaveLength(2);
      expect(entries[0]?.status).toBeNull();
      expect(entries.at(-1)?.status).toBe(200);
    }

    // Taking the last entry per id answers each request with its own answer,
    // however the answers interleaved. Compared as a set rather than a sorted
    // list, because the order the group keys walk is the map's and not the
    // record's, and the fact under test is which request each answer belongs to.
    expect(new Set([...grouped.values()].map((entries) => entries.at(-1)?.url))).toEqual(
      new Set(["/delays/fast", "/delays/slow"]),
    );
  } finally {
    openSlowGate = undefined;
    await application.close();
  }
});

test.serial("a registration told to capture nothing still writes no pending entry", async () => {
  const { application, address } = await bootApplication(UncapturedModule);
  try {
    await fetch(`${application.getUrl()}/users/42`);

    const payload = await readRequests(address);

    // The endpoint answers over a registration that records nothing, and the
    // entry written at arrival is behind the same switch as the one written at
    // completion: a policy that turned the record off must not leak one entry
    // per request through the arrival path.
    expect(payload).toMatchObject({ cursor: 0, entries: [] });
  } finally {
    await application.close();
  }
});

test.serial("headers false and body false leave their field out of the entry", async () => {
  const { application, address } = await bootApplication(SparseModule);
  try {
    await fetch(`${application.getUrl()}/users`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-trace-id": "abc" },
      body: JSON.stringify({ name: "ada" }),
    });

    const payload = await readRequests(address);
    const entry = answeredEntry(payload);

    expect(Object.hasOwn(entry, "headers")).toBe(false);
    expect(Object.hasOwn(entry, "body")).toBe(false);
    // The fields that are not captured are not optional metadata: the rest of the
    // entry is unchanged, so a consumer reads it the same way either way.
    expect(entry.method).toBe("POST");
    expect(entry.status).toBe(201);
  } finally {
    await application.close();
  }
});

test.serial("a body longer than bodyLimit is cut and marked", async () => {
  const { application, address } = await bootApplication(LimitedBodyModule);
  try {
    const sent = JSON.stringify({ name: "ada", email: "ada@example.com" });
    await fetch(`${application.getUrl()}/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: sent,
    });

    const payload = await readRequests(address);
    const entry = answeredEntry(payload);

    expect(entry.body?.endsWith("[truncated]")).toBe(true);
    // The limit governs the body; the marker is appended to the stored value.
    expect(entry.body).toBe(`${sent.slice(0, 16)}[truncated]`);
    expect(entry.body).toHaveLength(16 + "[truncated]".length);
  } finally {
    await application.close();
  }
});

test.serial("a body that arrived as text is stored as text, and cut like any other", async () => {
  const { application, address } = await bootApplication(LimitedBodyModule);
  try {
    const short = "hi ada";
    const long = "ada@example.com asks a question that does not fit";
    const headers = { "content-type": "text/plain" };

    await fetch(`${application.getUrl()}/users`, { method: "POST", headers, body: short });
    await fetch(`${application.getUrl()}/users`, { method: "POST", headers, body: long });

    const payload = await readRequests(address);
    const kept = findAnsweredEntry(payload, (record) => record.body === short);
    const cut = findAnsweredEntry(
      payload,
      (record) => record.body?.endsWith("[truncated]") === true,
    );

    // The route declares no body schema, so the platform hands the hook the text
    // the client sent rather than anything it parsed: it is stored as it arrived,
    // and the limit cuts it the way it cuts a serialized body. The two differ in
    // what this package reads, not in what the record states.
    expect(kept.body).toBe(short);
    expect(cut.body).toBe(`${long.slice(0, 16)}[truncated]`);
  } finally {
    await application.close();
  }
});

test.serial("a body that arrived as a literal JSON null is stated, not read as none", async () => {
  const { application, address } = await bootApplication(CapturedModule);
  try {
    await fetch(`${application.getUrl()}/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });

    const entry = answeredEntry(await readRequests(address));

    // The client sent a body and the route parsed it as `null`, which the
    // installed Elysia tells apart from the request that carried none — an
    // absent or empty body reads `undefined` there. A missing `body` here would
    // read as that absence, so the parsed `null` is stated as the text it
    // arrived as.
    expect(entry.body).toBe("null");
  } finally {
    await application.close();
  }
});

test.serial("a body this package cannot serialize is stated as unreadable", async () => {
  const { application, address } = await bootApplication(UnserializableModule);
  try {
    const answered = await fetch(`${application.getUrl()}/bigint`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"id":1}',
    });

    // The application is unaffected: the body is unserializable only for this
    // package's own read of it, never for the client or the route.
    expect(answered.status).toBe(200);

    const entry = answeredEntry(await readRequests(address));

    // A missing `body` would read as a request that carried none, which is a
    // claim about the request rather than an absence to leave out.
    expect(entry.body).toBe("[unserializable]");
  } finally {
    await application.close();
  }
});

test.serial("redact replaces a named header with the literal, whatever its case", async () => {
  const { application, address } = await bootApplication(RedactingModule);
  try {
    await fetch(`${application.getUrl()}/users/42`, {
      headers: { authorization: "Bearer secret", "x-trace-id": "abc" },
    });

    const payload = await readRequests(address);
    const entry = answeredEntry(payload);

    // The options name the header in its canonical case; it arrives lowercased.
    // The header stays in place rather than disappearing: a consumer can see
    // that one was sent and that the tool was told not to show it.
    expect(entry.headers?.authorization).toBe("[redacted]");
    expect(entry.headers?.["x-trace-id"]).toBe("abc");
  } finally {
    await application.close();
  }
});

test.serial(
  "a failure carries the message the answer published, and an answer carries none",
  async () => {
    const { application, address } = await bootApplication(CapturedModule);
    try {
      await fetch(`${application.getUrl()}/explodes`);
      await fetch(`${application.getUrl()}/nope`);

      const payload = await readRequests(address);
      const failed = findAnsweredEntry(payload, (record) => record.url === "/explodes");
      const missing = findAnsweredEntry(payload, (record) => record.url === "/nope");

      expect(failed.status).toBe(500);
      expect(failed.error).toBe("The database is unreachable.");
      // A 4xx is an answer rather than a failure.
      expect(missing.status).toBe(404);
      expect(Object.hasOwn(missing, "error")).toBe(false);
    } finally {
      await application.close();
    }
  },
);

test.serial("an answer a handler built itself is recorded with the status it carries", async () => {
  const { application, address } = await bootApplication(CapturedModule);
  try {
    await fetch(`${application.getUrl()}/own`);

    const payload = await readRequests(address);
    const entry = findAnsweredEntry(payload, (record) => record.url === "/own");

    // `set.status` still reads `200` for a handler that answered with its own
    // `Response`: the status the record states is the one the client received.
    expect(entry.status).toBe(201);
  } finally {
    await application.close();
  }
});

test.serial("an unhandled failure carries the exception the platform mapped", async () => {
  const { application, address } = await bootApplication(CapturedModule);
  try {
    await fetch(`${application.getUrl()}/unhandled`);

    const payload = await readRequests(address);
    const entry = findAnsweredEntry(payload, (record) => record.url === "/unhandled");

    // The platform answers an unhandled failure with its own Problem Details
    // sentence, and that `Response` is not on the after-response context, so the
    // only account of the exception this side can publish is the one the
    // mapping recorded as it answered. It is the rendering `/logs` states for
    // the same exception: the name and the message, never the stack.
    expect(entry.status).toBe(500);
    expect(entry.error).toBe("Error: the raw exception");
  } finally {
    await application.close();
  }
});

test.serial("an exception's stack is never published", async () => {
  const { application, address } = await bootApplication(CapturedModule);
  try {
    await fetch(`${application.getUrl()}/unhandled`);

    const payload = await readRequests(address);
    const entry = findAnsweredEntry(payload, (record) => record.url === "/unhandled");

    // The premise is asserted before the comparison, because an absent `error`
    // would satisfy a `not.toContain` on its own and prove nothing about what
    // the record publishes.
    expect(typeof entry.error).toBe("string");
    // A stack frame is `    at ...`, and the message the fixture threw carries
    // none of its own: anything below would be where the exception was thrown.
    expect(entry.error).not.toContain("at ");
    expect(entry.error).not.toContain("/");
  } finally {
    await application.close();
  }
});

test.serial("the exception the record reports is the one the log stream states", async () => {
  const output = captureOutput();
  let application: AponiaElysiaApplication | undefined;
  try {
    application = await AponiaFactory.create(LoggedFailureModule, { logger: agreeingLogger });
    await application.listen(0);

    const address = reportedAddress(output);
    // One route per turn, so the line `/logs` reports last is the line for the
    // request the record was just read for — two failures in one turn would be
    // told apart only by their order in two independently read windows. The
    // three thrown values are different shapes on purpose: an `Error`, a value
    // that is not one, and one the rendering cannot state at all take three
    // different branches of the one rendering both surfaces call, so the
    // comparison shows a branch per shape rather than the `Error` branch alone.
    const cases = [
      { path: "/unhandled", expected: "Error: the raw exception" },
      { path: "/unhandled-object", expected: '{"code":"E_CONN","retries":3}' },
      { path: "/unrenderable", expected: "[unrenderable]" },
    ];

    for (const expected of cases) {
      await fetch(`${application.getUrl()}${expected.path}`);

      const entry = findAnsweredEntry(
        await readRequests(address),
        (record) => record.url === expected.path,
      );
      const response = await fetch(`${address}/__devtools/logs`);
      const logs = (await response.json()) as AponiaLogsPayload;
      const reported = logs.entries.filter((item) => item.context === "ExceptionsHandler").at(-1);

      // Both halves are stated rather than read out of each other: the premise
      // that the failure reached both surfaces, and what the record is expected
      // to say about it.
      expect(reported).toBeDefined();
      expect(entry.error).toBe(expected.expected);
      expect(entry.error).toBe(reported?.message);
    }
  } finally {
    output.restore();
    await application?.close();
  }
});

test.serial(
  "a thrown value the rendering cannot read leaves the answer and the log line intact",
  async () => {
    // Two shapes, because the rendering reads more than the two values it states
    // out loud: one refuses `JSON.stringify` and the plain string form, and the
    // other refuses the property a function is named by — the read a rendering
    // guarded around only the pair it thought of would leave bare.
    //
    // They are read on two loggers, and the second is the reason why. The line a
    // failure writes is produced twice on its way out: this package's tap states
    // the value through `@aponiajs/common`'s `renderLogValue`, and then hands the
    // call, with the value, to the logger the application installed, which renders
    // it again for the console. The two renderings are different answers rather
    // than one restated, and each shape shows that from one side: the console
    // reaches a value that is neither a string nor a function with `inspect`, so
    // it states the cyclic shape's own `inspect` form and answers the trapping one
    // with `[unrenderable]`, because the property that function is named by throws
    // on the way; the rendering both surfaces call answers the cyclic shape with
    // `[unrenderable]` — it refuses the JSON form and the plain one — and the
    // trapping one with the function's own source text. What the assertions below
    // read is the rendering's own answer — `reported?.message`, and the record's
    // `error` — and never what the console printed.
    //
    // `silentFailureLogger` records the line and writes nothing, which is the state
    // this case is about: the value reaches the rendering, the tap states it, and
    // nothing below the tap reads it a second time.
    const cases = [
      {
        path: "/unrenderable",
        states: "[unrenderable]" as string | undefined,
        rootModule: LoggedFailureModule,
        logger: agreeingLogger,
      },
      {
        path: "/trap-refusal",
        states: undefined,
        rootModule: SilentFailureModule,
        logger: silentFailureLogger,
      },
    ];

    for (const expected of cases) {
      const output = captureOutput();
      let application: AponiaElysiaApplication | undefined;
      try {
        application = await AponiaFactory.create(expected.rootModule, { logger: expected.logger });
        await application.listen(0);

        const address = reportedAddress(output);
        const response = await fetch(`${application.getUrl()}${expected.path}`);

        // The premise first, and it is the whole point of the case: the answer
        // the client receives is still the platform's Problem Details `500`, so
        // neither half of the shared path cost it. The rendering is total, which
        // is why nothing on its own path is left to throw, and the platform's
        // error hook guards the logger call the tap answers, so a logger that
        // refuses this line is announced on `stderr` rather than allowed to take
        // the answer with it. A Problem Details `500` is the answer that says so.
        expect(response.status).toBe(500);
        expect(response.headers.get("content-type")).toContain("application/problem+json");

        const entry = findAnsweredEntry(
          await readRequests(address),
          (record) => record.url === expected.path,
        );
        const logs = (await (
          await fetch(`${address}/__devtools/logs`)
        ).json()) as AponiaLogsPayload;
        const reported = logs.entries.filter((item) => item.context === "ExceptionsHandler").at(-1);

        // The line is asserted as well as the record: a rendering that answered
        // without recording would leave the failure unreported in the one place it
        // was always reported, and the two surfaces state the same thing about it.
        expect(reported).toBeDefined();
        expect(typeof reported?.message).toBe("string");
        expect(entry.error).toBe(reported?.message);
        // What the first shape states is the literal both surfaces fall back to.
        // The second is held by the comparison above alone: what it states is the
        // function's own source text, and pinning that would pin this file's
        // formatting rather than the rendering.
        if (expected.states !== undefined) {
          expect(entry.error).toBe(expected.states);
        }
      } finally {
        output.restore();
        await application?.close();
      }
    }
  },
);

test.serial("a failure whose answer the client already holds carries no message", async () => {
  const { application, address } = await bootApplication(CapturedModule);
  try {
    await fetch(`${application.getUrl()}/own-failure`);

    const payload = await readRequests(address);
    const entry = findAnsweredEntry(payload, (record) => record.url === "/own-failure");

    expect(entry.status).toBe(503);
    // The answer's own `Response` is the one the client was handed, so its body
    // is already disturbed here and no published message can be read from it.
    expect(Object.hasOwn(entry, "error")).toBe(false);
  } finally {
    await application.close();
  }
});

test.serial("the duration does not include this package's own read of the answer", async () => {
  const { application, address } = await bootApplication(CapturedModule);
  let read = false;
  const clock = spyOn(performance, "now").mockImplementation(() => (read ? 1000 : 5));
  const originalJson = Response.prototype.json;
  const json = spyOn(Response.prototype, "json").mockImplementation(
    async function (this: Response) {
      read = true;

      return await originalJson.call(this);
    },
  );

  try {
    await fetch(`${application.getUrl()}/explodes`);

    const payload = await readRequests(address);
    const entry = findAnsweredEntry(payload, (record) => record.url === "/explodes");

    expect(entry.error).toBe("The database is unreachable.");
    // The clock reads `5` until something reads the answer's body and `1000`
    // after it: a duration stamped once that read resolved would report this
    // package's own work as time the application spent answering.
    expect(entry.durationMs).toBe(0);
  } finally {
    json.mockRestore();
    clock.mockRestore();
    await application.close();
  }
});

test.serial("the duration is not charged for the body this package serializes", async () => {
  const { application, address } = await bootApplication(BulkModule);
  bulkBodyRead = false;
  // The clock reads `5` until this package's own serializer reaches the parsed
  // body and `1000` after it, so the reading the record takes measures the same
  // window whichever position it is taken from: taken after the read — where the
  // defect had it — the entry reports `995` and fails the bound below, and taken
  // before it, `0`. Re-measured after the reading moved to the completion hook's
  // first statement, which is even earlier and still `0`, while the same
  // simulated regression still reports `995`.
  const clock = spyOn(performance, "now").mockImplementation(() => (bulkBodyRead ? 1000 : 5));

  try {
    await fetch(`${application.getUrl()}/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"id":1}',
    });

    const entry = answeredEntry(await readRequests(address));

    expect(entry.status).toBe(200);
    // The read this case makes expensive did happen: the record states the body
    // it serialized, so the duration assertion cannot pass by never reading it.
    expect(bulkBodyRead).toBe(true);
    expect(entry.body?.endsWith("[truncated]")).toBe(true);
    // At most a small floor rather than a share of the 400 KB this package
    // read: a duration that grew with the body would be charging the
    // application for the tool's own work.
    expect(entry.durationMs).toBeLessThan(50);
  } finally {
    clock.mockRestore();
    await application.close();
  }
});

test.serial("polling the record never adds to it", async () => {
  const { application, address } = await bootApplication(CapturedModule);
  try {
    await fetch(`${application.getUrl()}/users/42`);

    const first = await readRequests(address);
    const second = await readRequests(address, `?since=${first.cursor}`);

    // The devtools server is its own server, so reading the record is not one of
    // the application's own requests: the poll that follows the first answer is
    // answered with nothing, and the cursor it carries back is the one it asked
    // from.
    expect(first.cursor).toBe(2);
    expect(second.cursor).toBe(first.cursor);
    expect(second.entries).toEqual([]);
  } finally {
    await application.close();
  }
});

test.serial("a second listen serves the record of the boot it started", async () => {
  const output = captureOutput();
  let application: AponiaElysiaApplication | undefined;
  try {
    application = await AponiaFactory.create(CapturedModule, { logger: false });
    await application.listen(0);

    await fetch(`${application.getUrl()}/users/42`);
    expect((await readRequests(reportedAddress(output))).cursor).toBe(2);

    // The record belongs to the boot rather than to the registration: a second
    // `listen()` starts a second socket, and that socket serves a record of its
    // own rather than a window some other socket was serving. The spec states the
    // same boundary — the record is in memory, per boot, and a restart is a new
    // record — so an entry from a boot that is gone is not carried into the one
    // that replaced it.
    await application.listen(0);

    const addresses = reportedAddresses(output);
    expect(addresses).toHaveLength(2);

    const restarted = await readRequests(addresses[1] ?? "");

    expect(restarted.cursor).toBe(0);
    expect(restarted.entries).toEqual([]);
  } finally {
    await application?.close();
    output.restore();
  }
});

test.serial("an id keeps counting across the two boots of one registration", async () => {
  const output = captureOutput();
  let application: AponiaElysiaApplication | undefined;
  try {
    application = await AponiaFactory.create(CapturedModule, { logger: false });
    await application.listen(0);

    await fetch(`${application.getUrl()}/users/42`);

    const firstBoot = await readRequests(reportedAddress(output));

    // The comparison this case turns on is read off a window, so the window is
    // stated before it: `Math.max` of an empty window answers `-Infinity`, and
    // every id is greater than that, so a regression that emptied this window
    // would leave the case green while proving nothing. One request leaves two
    // entries and both carry its id, which is the premise grouping rests on.
    expect(firstBoot.entries).toHaveLength(2);
    expect(firstBoot.entries[0]?.id).toBe(firstBoot.entries[1]?.id);

    const lastOfFirstBoot = Math.max(...firstBoot.entries.map((record) => record.id));

    // A second `listen()` is a second boot of one registration: the record is
    // new, but the counter that mints an id belongs to the capture and outlives
    // the boot. An id that restarted at `1` here would let a consumer that kept
    // polling through the restart group this boot's first request with the
    // previous boot's — two different requests under one id.
    await application.listen(0);

    await fetch(`${application.getUrl()}/users/7`);

    const addresses = reportedAddresses(output);
    const secondBoot = await readRequests(addresses[1] ?? "");

    expect(secondBoot.entries).toHaveLength(2);
    expect(secondBoot.entries[0]?.id).toBeGreaterThan(lastOfFirstBoot);
  } finally {
    await application?.close();
    output.restore();
  }
});

test.serial("two registrations in one process record into their own windows", async () => {
  const first = await bootApplication(CapturedModule);
  let second: BootedApplication | undefined;
  try {
    second = await bootApplication(CapturedTwinModule);

    await fetch(`${first.application.getUrl()}/users/42`);
    await fetch(`${second.application.getUrl()}/users/42`);
    await fetch(`${second.application.getUrl()}/users/7`);

    const firstWindow = await readRequests(first.address);
    const secondWindow = await readRequests(second.address);

    // The record belongs to the registration rather than to the process: each
    // socket serves its own application's traffic, and neither window holds a
    // request the other application answered — neither in count nor in content.
    // One request leaves two entries, so each window's cursor counts two of them
    // and every url appears beside the pending entry that shares it.
    expect(firstWindow.cursor).toBe(2);
    expect(firstWindow.entries.map((record) => record.url)).toEqual(["/users/42", "/users/42"]);
    expect(secondWindow.cursor).toBe(4);
    expect(secondWindow.entries.map((record) => record.url)).toEqual([
      "/users/42",
      "/users/42",
      "/users/7",
      "/users/7",
    ]);
  } finally {
    await first.application.close();
    await second?.application.close();
  }
});

test.serial("two applications built from one module keep their records apart", async () => {
  const first = await bootApplication(CapturedModule);
  let second: BootedApplication | undefined;
  try {
    await fetch(`${first.application.getUrl()}/users/42`);
    expect((await readRequests(first.address)).cursor).toBe(2);

    // The platform hands one registration to every boot of the class that
    // declared it, so these two applications are one plugin with one pair of
    // hooks — which is the whole reason a record is filed per application rather
    // than held in one variable. The second boot also takes over the single
    // socket a registration drives, which is why only its address is read from
    // here on.
    second = await bootApplication(CapturedModule);

    await fetch(`${first.application.getUrl()}/users/7`);

    // The request above was answered by the first application, and it is in that
    // application's record: the second application's window states its own
    // traffic and nothing that another application answered.
    const secondWindow = await readRequests(second.address);

    expect(secondWindow.cursor).toBe(0);
    expect(secondWindow.entries).toEqual([]);
  } finally {
    await first.application.close();
    await second?.application.close();
  }
});
