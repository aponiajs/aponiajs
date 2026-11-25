import { expect, test } from "bun:test";
import { createRequestCapture, resolveCapture, type AnsweredRequest } from "./request-capture.ts";

/**
 * The capture is the pair of hooks that fills the request record. These cases
 * drive it directly with the values the platform hands each half, so they can
 * state a body, a status, a mapped exception, or a value that refuses to be
 * read without booting the whole surface. Every case asserts the record a
 * consumer polls, not the internal stamp map.
 */

function answered(overrides: Partial<AnsweredRequest> = {}): AnsweredRequest {
  return {
    request: new Request("http://localhost/users?id=1"),
    route: "/users/:id",
    body: undefined,
    status: 200,
    answered: true,
    answer: undefined,
    error: undefined,
    ...overrides,
  };
}

function entries(buffer: ReturnType<ReturnType<typeof createRequestCapture>["beginBoot"]>) {
  return buffer.since(0).entries;
}

test("resolveCapture resolves every opt-out from the registration's shorthand", () => {
  expect(resolveCapture(false)).toEqual({
    enabled: false,
    headers: false,
    body: false,
    bodyLimit: 0,
    redact: [],
  });
  expect(resolveCapture(undefined)).toEqual({
    enabled: true,
    headers: true,
    body: true,
    bodyLimit: 16384,
    redact: [],
  });
  expect(resolveCapture({ body: false, redact: ["Authorization", "X-Api-Key"] })).toEqual({
    enabled: true,
    headers: true,
    body: false,
    bodyLimit: 16384,
    redact: ["authorization", "x-api-key"],
  });
});

test("a capture told to record nothing retains nothing", async () => {
  const capture = createRequestCapture(false);
  const application = {};
  const buffer = capture.beginBoot(application);
  const request = new Request("http://localhost/users");

  capture.arrive(request, application);
  await capture.complete(answered({ request }), performance.now());

  expect(buffer.since(0)).toEqual({ cursor: 0, entries: [] });
});

test("an arrival for an application no boot opened writes nothing", () => {
  const capture = createRequestCapture(undefined);
  const request = new Request("http://localhost/users");

  capture.arrive(request, {});

  const buffer = capture.beginBoot({});
  expect(buffer.since(0)).toEqual({ cursor: 0, entries: [] });
});

test("arrival writes a pending entry the answer then supersedes under the same id", async () => {
  const capture = createRequestCapture(undefined);
  const application = {};
  const buffer = capture.beginBoot(application);
  const request = new Request("http://localhost/users?id=1", {
    method: "POST",
    headers: { "x-trace": "trace-1" },
  });

  capture.arrive(request, application);
  const [pending] = entries(buffer);

  expect(pending?.id).toBe(1);
  expect(pending?.method).toBe("POST");
  expect(pending?.path).toBe("/users");
  expect(pending?.url).toBe("/users?id=1");
  expect(pending?.status).toBeNull();
  expect(pending?.durationMs).toBeNull();
  expect(pending?.headers).toEqual({ "x-trace": "trace-1" });
  expect(typeof pending?.timestamp).toBe("string");

  await capture.complete(
    answered({ request, route: "/users/:id", status: 201, answer: undefined }),
    performance.now() + 2,
  );
  const all = entries(buffer);

  expect(all).toHaveLength(2);
  expect(all[0]?.id).toBe(all[1]?.id);
  expect(all[1]?.path).toBe("/users/:id");
  expect(all[1]?.url).toBe("/users?id=1");
  expect(all[1]?.status).toBe(201);
  expect(typeof all[1]?.durationMs).toBe("number");
  expect(all[1]?.durationMs).toBeGreaterThanOrEqual(0);
  expect(all[1]?.headers).toEqual({ "x-trace": "trace-1" });
});

test("a completion for a request this registration never saw writes nothing", async () => {
  const capture = createRequestCapture(undefined);
  const buffer = capture.beginBoot({});

  await capture.complete(answered(), performance.now());

  expect(buffer.since(0)).toEqual({ cursor: 0, entries: [] });
});

test("an answer the context states nothing about leaves the pending entry standing", async () => {
  const capture = createRequestCapture(undefined);
  const application = {};
  const buffer = capture.beginBoot(application);
  const request = new Request("http://localhost/users");

  capture.arrive(request, application);
  await capture.complete(answered({ request, answered: false }), performance.now());

  expect(entries(buffer)).toHaveLength(1);
  expect(entries(buffer)[0]?.status).toBeNull();

  // The stamp was spent, so a later completion writes nothing either.
  await capture.complete(answered({ request }), performance.now());
  expect(entries(buffer)).toHaveLength(1);
});

test("the body is stored as text, serialized, truncated, or marked unserializable", async () => {
  async function bodyOf(
    body: unknown,
    capture = createRequestCapture({ bodyLimit: 100 }),
  ): Promise<string | undefined> {
    const application = {};
    const buffer = capture.beginBoot(application);
    const request = new Request("http://localhost/users");
    capture.arrive(request, application);
    await capture.complete(answered({ request, body }), performance.now());
    return entries(buffer)[1]?.body;
  }

  expect(await bodyOf("abcdefgh", createRequestCapture({ bodyLimit: 5 }))).toBe("abcde[truncated]");
  expect(await bodyOf('{"a":1}', createRequestCapture({ bodyLimit: 5 }))).toBe('{"a":[truncated]');
  expect(await bodyOf("abc")).toBe("abc");
  expect(await bodyOf({ a: 1 })).toBe('{"a":1}');
  expect(await bodyOf(null)).toBe("null");
  expect(await bodyOf(10n)).toBe("[unserializable]");

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  expect(await bodyOf(circular)).toBe("[unserializable]");

  expect(await bodyOf(undefined)).toBeUndefined();
});

test("a policy that captures no body leaves the body key out", async () => {
  const capture = createRequestCapture({ body: false });
  const application = {};
  const buffer = capture.beginBoot(application);
  const request = new Request("http://localhost/users");

  capture.arrive(request, application);
  await capture.complete(answered({ request, body: "ignored" }), performance.now());

  expect(Object.hasOwn(entries(buffer)[1]!, "body")).toBe(false);
});

test("a policy that captures no headers leaves them off both entries", async () => {
  const capture = createRequestCapture({ headers: false });
  const application = {};
  const buffer = capture.beginBoot(application);
  const request = new Request("http://localhost/users", { headers: { "x-trace": "1" } });

  capture.arrive(request, application);
  await capture.complete(answered({ request }), performance.now());

  const [pending, answer] = entries(buffer);
  expect(Object.hasOwn(pending!, "headers")).toBe(false);
  expect(Object.hasOwn(answer!, "headers")).toBe(false);
});

test("a redacted header is replaced on both entries regardless of its case", async () => {
  const capture = createRequestCapture({ redact: ["Authorization"] });
  const application = {};
  const buffer = capture.beginBoot(application);
  const request = new Request("http://localhost/users", {
    headers: { Authorization: "Bearer secret", "x-trace": "1" },
  });

  capture.arrive(request, application);
  await capture.complete(answered({ request }), performance.now());

  for (const entry of entries(buffer)) {
    expect(entry.headers?.authorization).toBe("[redacted]");
    expect(entry.headers?.["x-trace"]).toBe("1");
  }
});

test("a handler-built Response states the status and published detail the client received", async () => {
  const capture = createRequestCapture(undefined);
  const application = {};
  const buffer = capture.beginBoot(application);
  const request = new Request("http://localhost/users");

  capture.arrive(request, application);
  await capture.complete(
    answered({
      request,
      status: 200,
      answer: Response.json({ detail: "database is down" }, { status: 503 }),
    }),
    performance.now(),
  );

  const answer = entries(buffer)[1];
  expect(answer?.status).toBe(503);
  expect(answer?.error).toBe("database is down");
});

test("a 5xx whose body cannot be read falls back to the exception the boot mapped", async () => {
  const capture = createRequestCapture(undefined);
  const application = {};
  const request = new Request("http://localhost/users");
  const mapped = new WeakMap<Request, string>([[request, "unhandled failure"]]);
  const buffer = capture.beginBoot(application, mapped);

  capture.arrive(request, application);
  await capture.complete(
    answered({ request, status: 500, answer: new Response("not json", { status: 500 }) }),
    performance.now(),
  );

  expect(entries(buffer)[1]?.error).toBe("unhandled failure");
});

test("a 5xx with no mapped exception states the exception's own message", async () => {
  const capture = createRequestCapture(undefined);
  const application = {};
  const buffer = capture.beginBoot(application);
  const request = new Request("http://localhost/users");

  capture.arrive(request, application);
  await capture.complete(
    answered({ request, status: 500, error: new Error("exploded") }),
    performance.now(),
  );

  expect(entries(buffer)[1]?.error).toBe("exploded");
});

test("an exception whose prototype walk refuses reads as no message rather than a failure", async () => {
  const capture = createRequestCapture(undefined);
  const application = {};
  const buffer = capture.beginBoot(application);
  const request = new Request("http://localhost/users");
  const refusing = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new TypeError("refused");
      },
    },
  );

  capture.arrive(request, application);
  await capture.complete(answered({ request, status: 500, error: refusing }), performance.now());

  expect(Object.hasOwn(entries(buffer)[1]!, "error")).toBe(false);
});

test("a 4xx is an answer rather than a failure and carries no error", async () => {
  const capture = createRequestCapture(undefined);
  const application = {};
  const buffer = capture.beginBoot(application);
  const request = new Request("http://localhost/missing");

  capture.arrive(request, application);
  await capture.complete(
    answered({ request, route: undefined, status: 404, error: new Error("Not Found") }),
    performance.now(),
  );

  const answer = entries(buffer)[1];
  expect(answer?.status).toBe(404);
  expect(answer?.path).toBe("/missing");
  expect(Object.hasOwn(answer!, "error")).toBe(false);
});

test("a request URL that cannot be parsed is recorded as it arrived", async () => {
  const capture = createRequestCapture(undefined);
  const application = {};
  const buffer = capture.beginBoot(application);
  const request = new Request("http://localhost/users?x=1");
  Object.defineProperty(request, "url", { value: "/users?x=1" });

  capture.arrive(request, application);
  await capture.complete(answered({ request, route: undefined }), performance.now());

  const answer = entries(buffer)[1];
  expect(answer?.path).toBe("/users?x=1");
  expect(answer?.url).toBe("/users?x=1");
});

test("store and state snapshots omit internal, runtime, function, and unreadable keys", async () => {
  const capture = createRequestCapture(undefined);
  const application = {};
  const buffer = capture.beginBoot(application);
  const request = new Request("http://localhost/users");

  const store: Record<string, unknown> = {
    _private: 1,
    aponiaInternal: 2,
    fn: () => undefined,
    visible: "yes",
  };
  Object.defineProperty(store, "explosive", {
    enumerable: true,
    get() {
      throw new Error("unreadable");
    },
  });

  capture.arrive(request, application);
  await capture.complete(
    answered({ request, store, state: { _hidden: true, aponiaX: 1, kept: 2 } }),
    performance.now(),
  );

  const answer = entries(buffer)[1];
  expect(answer?.store).toEqual({ visible: "yes" });
  expect(answer?.state).toEqual({ kept: 2 });

  // A snapshot that is not an object states nothing rather than an empty map.
  const second = new Request("http://localhost/users");
  capture.arrive(second, application);
  await capture.complete(
    answered({ request: second, store: "nope", state: null }),
    performance.now(),
  );
  const secondAnswer = entries(buffer).at(-1);
  expect(Object.hasOwn(secondAnswer!, "store")).toBe(false);
  expect(Object.hasOwn(secondAnswer!, "state")).toBe(false);
});

test("two boots file their mapped exceptions against their own records", async () => {
  const capture = createRequestCapture(undefined);
  const firstIdentity = {};
  const secondIdentity = {};
  const firstRequest = new Request("http://localhost/first");
  const secondRequest = new Request("http://localhost/second");

  const firstBuffer = capture.beginBoot(
    firstIdentity,
    new WeakMap<Request, string>([[firstRequest, "first failure"]]),
  );
  const secondBuffer = capture.beginBoot(secondIdentity);

  capture.arrive(firstRequest, firstIdentity);
  capture.arrive(secondRequest, secondIdentity);
  await capture.complete(
    answered({ request: firstRequest, status: 500, answer: new Response("no", { status: 500 }) }),
    performance.now(),
  );
  await capture.complete(
    answered({ request: secondRequest, status: 500, answer: new Response("no", { status: 500 }) }),
    performance.now(),
  );

  expect(entries(firstBuffer)[1]?.error).toBe("first failure");
  expect(Object.hasOwn(entries(secondBuffer)[1]!, "error")).toBe(false);
});
