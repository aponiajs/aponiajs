import { expect, spyOn, test } from "bun:test";
import { Body, Controller, Get, Module, Post, Status } from "@aponiajs/common";
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
  const output = captureOutput();
  try {
    const application = await AponiaFactory.create(rootModule, { logger: false });
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

test.serial("an unhandled failure is recorded without a message it cannot read", async () => {
  const { application, address } = await bootApplication(CapturedModule);
  try {
    await fetch(`${application.getUrl()}/unhandled`);

    const payload = await readRequests(address);
    const entry = findAnsweredEntry(payload, (record) => record.url === "/unhandled");

    // The platform answers an unhandled failure with its own Problem Details
    // sentence, and that answer is not on the after-response context: the record
    // states the failure and leaves the message out rather than repeating the
    // exception, which is what the log stream is for.
    expect(entry.status).toBe(500);
    expect(Object.hasOwn(entry, "error")).toBe(false);
  } finally {
    await application.close();
  }
});

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
