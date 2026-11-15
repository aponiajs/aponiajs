import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { encode } from "cborg";
import {
  createMicroserviceClient,
  createMicroserviceServer,
  decodeMicroserviceEnvelope,
  encodeMicroserviceEnvelope,
  MicroserviceCallError,
} from "../src/index.ts";
import { encodeMicroserviceReply } from "../src/envelope/microservice-envelope.ts";
import type {
  Transport,
  TransportHandler,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "../src/transport/transport.types.ts";

class FakeTransport implements Transport {
  readonly name: string;
  readonly published: {
    readonly destination: string;
    readonly payload: Uint8Array;
    readonly replyTo: string | undefined;
  }[] = [];
  readonly handlers = new Map<string, TransportHandler>();
  readonly subscriptions: TransportSubscription[] = [];
  connected = false;
  closed = false;
  failPublish: AponiaError | undefined;
  failConnect: Error | undefined;
  failSubscribe: Error | undefined;
  failSubscriptionClose = false;
  failClose = false;

  constructor(name = "fake") {
    this.name = name;
  }

  async connect(): Promise<void> {
    if (this.failConnect !== undefined) {
      throw this.failConnect;
    }
    if (this.closed) {
      throw new AponiaError("MICROSERVICE_TRANSPORT_UNAVAILABLE", "closed", {
        transport: this.name,
      });
    }
    this.connected = true;
  }

  async publish(destination: string, payload: Uint8Array, replyTo?: string): Promise<void> {
    if (!this.connected) {
      throw new AponiaError("MICROSERVICE_TRANSPORT_UNAVAILABLE", "not connected", {
        transport: this.name,
      });
    }
    if (this.failPublish !== undefined) {
      throw this.failPublish;
    }
    this.published.push({ destination, payload, replyTo });
  }

  async subscribe(
    subscription: TransportSubscription,
    handler: TransportHandler,
  ): Promise<TransportSubscriptionHandle> {
    if (this.failSubscribe !== undefined) {
      throw this.failSubscribe;
    }
    this.subscriptions.push(subscription);
    this.handlers.set(subscription.destination, handler);
    return Object.freeze({
      close: () => {
        this.handlers.delete(subscription.destination);
        if (this.failSubscriptionClose) {
          throw new Error("close failed");
        }
      },
    });
  }

  async close(): Promise<void> {
    if (this.failClose) {
      throw new Error("close failed");
    }
    this.closed = true;
    this.handlers.clear();
  }

  async deliver(
    destination: string,
    payload: Uint8Array,
    replyTo?: string,
  ): Promise<"ack" | "nack" | "missing"> {
    const handler = this.handlers.get(destination);
    if (handler === undefined) {
      return "missing";
    }
    return await handler({ payload, ...(replyTo === undefined ? {} : { replyTo }) });
  }
}

function requestPayload(overrides: Record<string, unknown> = {}): Uint8Array {
  return encodeMicroserviceEnvelope({
    v: 1,
    kind: "request",
    id: "req-1",
    pattern: "users.findOne",
    data: { id: "1" },
    target: "default",
    replyTo: "replies.client",
    ...overrides,
  });
}

function replyPayload(id: string, value: unknown): Uint8Array {
  return encodeMicroserviceReply({ v: 1, kind: "reply", id, ok: true, value });
}

function failedReplyPayload(id: string, code: string): Uint8Array {
  return encodeMicroserviceReply({
    v: 1,
    kind: "reply",
    id,
    ok: false,
    error: { code, message: "failed" },
  });
}

function decodedReply(payload: Uint8Array) {
  const envelope = decodeMicroserviceEnvelope(payload);
  if (envelope.kind !== "reply") {
    throw new Error("expected a reply envelope");
  }
  return envelope;
}

describe("microservice client", () => {
  test("publishes a request and resolves the correlated reply", async () => {
    const transport = new FakeTransport();
    const client = createMicroserviceClient({
      transport,
      destination: "requests",
      replyTo: "replies.client",
    });

    await client.connect();
    expect(transport.subscriptions).toEqual([{ destination: "replies.client" }]);

    const call = client.send("users.findOne", { id: "1" });
    await Bun.sleep(0);
    const published = transport.published[0];
    expect(published?.destination).toBe("requests");
    expect(published?.replyTo).toBe("replies.client");
    const envelope = decodeMicroserviceEnvelope(published?.payload ?? new Uint8Array());
    if (envelope.kind !== "request") {
      throw new Error("expected a request envelope");
    }
    expect(envelope.pattern).toBe("users.findOne");
    expect(envelope.data).toEqual({ id: "1" });
    expect(envelope.target).toBe("default");

    expect(await transport.deliver("replies.client", replyPayload(envelope.id, { id: "1" }))).toBe(
      "ack",
    );
    expect(await call).toEqual({ id: "1" });
    await client.close();
  });

  test("emits an event without a reply subscription delivery", async () => {
    const transport = new FakeTransport();
    const client = createMicroserviceClient({
      transport,
      destination: "events",
      replyTo: "replies.client",
      target: "orders",
    });

    await client.connect();
    await client.emit("users.created", { id: "1" });

    const envelope = decodeMicroserviceEnvelope(
      transport.published[0]?.payload ?? new Uint8Array(),
    );
    expect(envelope.kind).toBe("event");
    if (envelope.kind === "event") {
      expect(envelope.pattern).toBe("users.created");
      expect(envelope.target).toBe("orders");
    }
    await client.close();
  });

  test("subscribes to replySubscription while publishing to replyTo", async () => {
    const transport = new FakeTransport();
    const client = createMicroserviceClient({
      transport,
      destination: "requests",
      replyTo: "replies-topic",
      replySubscription: "replies-subscription",
    });

    await client.connect();
    expect(transport.subscriptions).toEqual([{ destination: "replies-subscription" }]);
    const call = client.send("users.findOne");
    await Bun.sleep(0);
    expect(transport.published[0]?.replyTo).toBe("replies-topic");
    const envelope = decodeMicroserviceEnvelope(
      transport.published[0]?.payload ?? new Uint8Array(),
    );
    if (envelope.kind !== "request") {
      throw new Error("expected a request envelope");
    }
    await transport.deliver("replies-subscription", replyPayload(envelope.id, 1));
    expect(await call).toBe(1);
    await client.close();
  });

  test("reports a failed reply with its stable code", async () => {
    const transport = new FakeTransport();
    const client = createMicroserviceClient({
      transport,
      destination: "requests",
      replyTo: "replies.client",
    });
    await client.connect();

    const call = client.send("users.findOne");
    await Bun.sleep(0);
    const envelope = decodeMicroserviceEnvelope(
      transport.published[0]?.payload ?? new Uint8Array(),
    );
    if (envelope.kind !== "request") {
      throw new Error("expected a request envelope");
    }
    await transport.deliver(
      "replies.client",
      failedReplyPayload(envelope.id, "UNKNOWN_MESSAGE_PATTERN"),
    );

    const failure = await call.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MicroserviceCallError);
    expect((failure as MicroserviceCallError).code).toBe("UNKNOWN_MESSAGE_PATTERN");
    await client.close();
  });

  test("times out a request that is not answered", async () => {
    const transport = new FakeTransport();
    const client = createMicroserviceClient({
      transport,
      destination: "requests",
      replyTo: "replies.client",
      requestTimeoutMs: 5,
    });
    await client.connect();

    const failure = await client.send("users.findOne").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MicroserviceCallError);
    expect((failure as MicroserviceCallError).code).toBe("MICROSERVICE_REQUEST_TIMEOUT");
    await client.close();
  });

  test("bounds pending calls", async () => {
    const transport = new FakeTransport();
    const client = createMicroserviceClient({
      transport,
      destination: "requests",
      replyTo: "replies.client",
      maxPendingCalls: 1,
      requestTimeoutMs: 1_000,
    });
    await client.connect();

    const first = client.send("users.findOne");
    await Bun.sleep(0);
    const failure = await client.send("users.findOne").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MicroserviceCallError);
    expect((failure as MicroserviceCallError).code).toBe("MICROSERVICE_CLIENT_OVERLOADED");
    await client.close();
    expect(await first.catch((error: unknown) => error)).toBeInstanceOf(MicroserviceCallError);
  });

  test("rejects pending calls when it closes", async () => {
    const transport = new FakeTransport();
    const client = createMicroserviceClient({
      transport,
      destination: "requests",
      replyTo: "replies.client",
    });
    await client.connect();

    const call = client.send("users.findOne");
    await Bun.sleep(0);
    await client.close();

    const failure = await call.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MicroserviceCallError);
    expect((failure as MicroserviceCallError).code).toBe("MICROSERVICE_CLIENT_CLOSED");
  });

  test("reports a publish failure to both call styles", async () => {
    const transport = new FakeTransport();
    transport.failPublish = new AponiaError("MICROSERVICE_DELIVERY_FAILED", "publish failed", {
      transport: "fake",
      operation: "publish",
    });
    const client = createMicroserviceClient({
      transport,
      destination: "requests",
      replyTo: "replies.client",
    });
    await client.connect();

    const sendFailure = await client.send("users.findOne").catch((error: unknown) => error);
    expect(sendFailure).toBeInstanceOf(MicroserviceCallError);
    expect((sendFailure as MicroserviceCallError).code).toBe("MICROSERVICE_DELIVERY_FAILED");
    const emitFailure = await client.emit("users.created").catch((error: unknown) => error);
    expect(emitFailure).toBeInstanceOf(MicroserviceCallError);
    expect((emitFailure as MicroserviceCallError).code).toBe("MICROSERVICE_DELIVERY_FAILED");
    await client.close();
  });

  test("ignores malformed, unrelated, duplicate, and late replies", async () => {
    const transport = new FakeTransport();
    const client = createMicroserviceClient({
      transport,
      destination: "requests",
      replyTo: "replies.client",
    });
    await client.connect();
    const handler = transport.handlers.get("replies.client");
    expect(handler).toBeDefined();

    expect(await handler?.({ payload: new Uint8Array([0xff]) })).toBe("ack");
    expect(await handler?.({ payload: requestPayload() })).toBe("ack");
    expect(await transport.deliver("replies.client", replyPayload("missing", 1))).toBe("ack");

    const call = client.send("users.findOne");
    await Bun.sleep(0);
    const envelope = decodeMicroserviceEnvelope(
      transport.published[0]?.payload ?? new Uint8Array(),
    );
    if (envelope.kind !== "request") {
      throw new Error("expected a request envelope");
    }
    await transport.deliver("replies.client", replyPayload(envelope.id, "first"));
    await transport.deliver("replies.client", replyPayload(envelope.id, "second"));
    expect(await call).toBe("first");
    await client.close();
  });

  test("refuses invalid configuration", () => {
    const transport = new FakeTransport();
    const invalid = [
      {},
      { transport, destination: "", replyTo: "replies" },
      { transport, destination: "requests", replyTo: "" },
      { transport, destination: "requests", replyTo: "replies", requestTimeoutMs: 0 },
      { transport, destination: "requests", replyTo: "replies", maxPendingCalls: 0 },
      { transport, destination: "requests", replyTo: "replies", replySubscription: "" },
    ];
    for (const config of invalid) {
      const failure = (() => {
        try {
          createMicroserviceClient(config as never);
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      expect(failure).toBeInstanceOf(AponiaError);
      expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
    }
  });

  test("refuses a call before connect and after close", async () => {
    const transport = new FakeTransport();
    const client = createMicroserviceClient({
      transport,
      destination: "requests",
      replyTo: "replies.client",
    });

    const before = await client.send("users.findOne").catch((error: unknown) => error);
    expect(before).toBeInstanceOf(MicroserviceCallError);
    expect((before as MicroserviceCallError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");

    await client.connect();
    await client.close();
    const after = await client.emit("users.created").catch((error: unknown) => error);
    expect(after).toBeInstanceOf(MicroserviceCallError);
    expect((after as MicroserviceCallError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
  });

  test("sanitizes a transport connect failure", async () => {
    const transport = new FakeTransport();
    transport.failConnect = new Error("connection string secret");
    const client = createMicroserviceClient({
      transport,
      destination: "requests",
      replyTo: "replies.client",
    });

    const failure = await client.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).message).not.toContain("secret");
  });

  test("closes the transport when the reply subscription fails", async () => {
    const transport = new FakeTransport();
    transport.failSubscribe = new Error("subscribe failed");
    const client = createMicroserviceClient({
      transport,
      destination: "requests",
      replyTo: "replies.client",
    });

    const failure = await client.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_DELIVERY_FAILED");
    expect(transport.closed).toBe(true);
  });

  test("swallows reply-subscription and transport close failures", async () => {
    const transport = new FakeTransport();
    const client = createMicroserviceClient({
      transport,
      destination: "requests",
      replyTo: "replies.client",
    });
    await client.connect();
    transport.failSubscriptionClose = true;
    transport.failClose = true;

    await client.close();
    expect(transport.closed).toBe(false);
  });

  test("reports malformed transport members and identity options", () => {
    const failures = [
      () =>
        createMicroserviceClient({
          transport: {} as never,
          destination: "requests",
          replyTo: "replies",
        }),
      () =>
        createMicroserviceClient({
          transport: new FakeTransport(),
          destination: "requests",
          replyTo: "replies",
          target: "",
        }),
      () =>
        createMicroserviceClient({
          transport: new FakeTransport(),
          destination: "requests",
          replyTo: "replies",
          name: "",
        }),
      () =>
        createMicroserviceClient({
          transport: new FakeTransport(),
          destination: "requests",
          replyTo: "replies",
          connectTimeoutMs: 0,
        }),
    ];
    for (const build of failures) {
      const failure = (() => {
        try {
          build();
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      expect(failure).toBeInstanceOf(AponiaError);
      expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
    }
  });
});

describe("microservice server", () => {
  test("answers a request for its target through the reply destination", async () => {
    const transport = new FakeTransport();
    const seenReplyTo: (string | undefined)[] = [];
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
      target: "orders",
      replyDestinations: ["replies.client"],
    });
    await server.subscribe(async (message) => {
      seenReplyTo.push(message.replyTo);
      return { ok: true, value: { id: message.data } };
    });

    const decision = await transport.deliver("requests", requestPayload({ target: "orders" }));
    expect(decision).toBe("ack");
    expect(seenReplyTo).toEqual(["replies.client"]);
    expect(transport.published[0]?.destination).toBe("replies.client");
    const reply = decodedReply(transport.published[0]?.payload ?? new Uint8Array());
    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.value).toEqual({ id: { id: "1" } });
    }
    await server.close();
  });

  test("answers a request addressed to another target", async () => {
    const transport = new FakeTransport();
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
      target: "orders",
    });
    let invoked = false;
    await server.subscribe(async () => {
      invoked = true;
      return { ok: true, value: 1 };
    });

    await transport.deliver("requests", requestPayload({ target: "billing" }));
    expect(invoked).toBe(false);
    const reply = decodedReply(transport.published[0]?.payload ?? new Uint8Array());
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.code).toBe("INVALID_MICROSERVICE_MESSAGE");
    }
    await server.close();
  });

  test("drops a request whose reply destination is outside the allowlist", async () => {
    const transport = new FakeTransport();
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
      replyDestinations: ["replies.allowed"],
    });
    let invoked = false;
    await server.subscribe(async () => {
      invoked = true;
      return { ok: true, value: 1 };
    });

    expect(await transport.deliver("requests", requestPayload())).toBe("ack");
    expect(invoked).toBe(false);
    expect(transport.published).toEqual([]);
    await server.close();
  });

  test("answers a malformed request whose readable reply destination is allowed", async () => {
    const transport = new FakeTransport();
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
      replyDestinations: ["replies.client"],
    });
    await server.subscribe(async () => ({ ok: true, value: 1 }));

    const malformed = encode({
      v: 1,
      kind: "request",
      id: "req-1",
      pattern: "users.findOne",
      target: "default",
      replyTo: "replies.client",
      data: {},
      extra: true,
    });
    expect(await transport.deliver("requests", malformed)).toBe("ack");
    const reply = decodedReply(transport.published[0]?.payload ?? new Uint8Array());
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.code).toBe("INVALID_MICROSERVICE_ENVELOPE");
    }
    await server.close();
  });

  test("acks an unreadable message without publishing", async () => {
    const transport = new FakeTransport();
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
    });
    await server.subscribe(async () => ({ ok: true, value: 1 }));

    expect(await transport.deliver("requests", new Uint8Array([0xff]))).toBe("ack");
    expect(transport.published).toEqual([]);
    await server.close();
  });

  test("dispatches events and drops one addressed to another target", async () => {
    const transport = new FakeTransport();
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "events" }],
      target: "orders",
    });
    const patterns: string[] = [];
    await server.subscribe(async (message) => {
      patterns.push(message.pattern);
      return { ok: true, value: undefined };
    });

    const event = encodeMicroserviceEnvelope({
      v: 1,
      kind: "event",
      id: "evt-1",
      pattern: "users.created",
      data: { id: "1" },
      target: "orders",
    });
    expect(await transport.deliver("events", event)).toBe("ack");
    const foreign = encodeMicroserviceEnvelope({
      v: 1,
      kind: "event",
      id: "evt-2",
      pattern: "users.created",
      data: { id: "2" },
      target: "billing",
    });
    expect(await transport.deliver("events", foreign)).toBe("ack");

    expect(patterns).toEqual(["users.created"]);
    expect(transport.published).toEqual([]);
    await server.close();
  });

  test("reports handler failure without publishing a stack", async () => {
    const transport = new FakeTransport();
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
    });
    await server.subscribe(async () => {
      throw new Error("secret database password");
    });

    await transport.deliver("requests", requestPayload());
    const reply = decodedReply(transport.published[0]?.payload ?? new Uint8Array());
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.code).toBe("MESSAGE_HANDLER_ERROR");
      expect(reply.error.message).not.toContain("secret database password");
    }
    await server.close();
  });

  test("answers an overloaded request", async () => {
    const transport = new FakeTransport();
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
      replyDestinations: ["replies.client"],
      maxInFlight: 1,
    });
    let release: (() => void) | undefined;
    let started = false;
    await server.subscribe(async () => {
      if (started) {
        return { ok: true, value: "second" };
      }
      started = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ok: true, value: "first" };
    });

    const first = transport.deliver("requests", requestPayload({ id: "req-1" }));
    await Bun.sleep(0);
    await transport.deliver("requests", requestPayload({ id: "req-2" }));
    const overload = decodedReply(transport.published[0]?.payload ?? new Uint8Array());
    expect(overload.ok).toBe(false);
    if (!overload.ok) {
      expect(overload.error.code).toBe("MICROSERVICE_SERVER_OVERLOADED");
    }
    release?.();
    expect(await first).toBe("ack");
    await server.close();
  });

  test("drops an event at the in-flight limit", async () => {
    const transport = new FakeTransport();
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "events" }],
      maxInFlight: 1,
    });
    let release: (() => void) | undefined;
    let invocations = 0;
    await server.subscribe(async () => {
      invocations += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ok: true, value: undefined };
    });

    const event = encodeMicroserviceEnvelope({
      v: 1,
      kind: "event",
      id: "evt-1",
      pattern: "users.created",
      data: {},
      target: "default",
    });
    const first = transport.deliver("events", event);
    await Bun.sleep(0);
    expect(await transport.deliver("events", event)).toBe("ack");
    expect(invocations).toBe(1);
    release?.();
    expect(await first).toBe("ack");
    await server.close();
  });

  test("refuses a second subscription and cleans up partial startup", async () => {
    const transport = new FakeTransport();
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
    });
    await server.subscribe(async () => ({ ok: true, value: 1 }));
    let failure: unknown;
    try {
      await server.subscribe(async () => ({ ok: true, value: 1 }));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_TRANSPORT");
    await server.close();
    await server.close();
    expect(transport.closed).toBe(true);
  });

  test("refuses invalid configuration", () => {
    const transport = new FakeTransport();
    const invalid = [
      { transport, subscriptions: [] },
      { transport, subscriptions: [{ destination: "" }] },
      { transport, subscriptions: [{ destination: "requests" }], maxInFlight: 0 },
      { transport, subscriptions: [{ destination: "requests" }], connectTimeoutMs: 0 },
      { transport, subscriptions: [{ destination: "requests" }], closeTimeoutMs: 0 },
      { transport, subscriptions: [{ destination: "requests" }], replyDestinations: [""] },
      { transport, subscriptions: [{ destination: "requests" }], logger: {} },
    ];
    for (const config of invalid) {
      const failure = (() => {
        try {
          createMicroserviceServer(config as never);
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      expect(failure).toBeInstanceOf(AponiaError);
      expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
    }
  });

  test("refuses to subscribe after close and without a handler", async () => {
    const transport = new FakeTransport();
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
    });
    await server.close();
    let closed: unknown;
    try {
      await server.subscribe(async () => ({ ok: true, value: 1 }));
    } catch (error) {
      closed = error;
    }
    expect(closed).toBeInstanceOf(AponiaError);
    expect((closed as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");

    const fresh = createMicroserviceServer({
      transport: new FakeTransport(),
      subscriptions: [{ destination: "requests" }],
    });
    let invalid: unknown;
    try {
      await fresh.subscribe(undefined as never);
    } catch (error) {
      invalid = error;
    }
    expect(invalid).toBeInstanceOf(AponiaError);
    expect((invalid as AponiaError).code).toBe("INVALID_MICROSERVICE_TRANSPORT");
    await fresh.close();
  });

  test("releases the transport when a connect fails during startup", async () => {
    const transport = new FakeTransport();
    transport.failConnect = new Error("broker refused");
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
    });

    let failure: unknown;
    try {
      await server.subscribe(async () => ({ ok: true, value: 1 }));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect(transport.closed).toBe(true);
  });

  test("ignores a reply envelope delivered to the server", async () => {
    const transport = new FakeTransport();
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
    });
    await server.subscribe(async () => ({ ok: true, value: 1 }));

    expect(await transport.deliver("requests", replyPayload("req-1", 1))).toBe("ack");
    expect(transport.published).toEqual([]);
    await server.close();
  });

  test("prefers an allowed native reply destination", async () => {
    const transport = new FakeTransport();
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
      replyDestinations: ["replies.hinted", "replies.client"],
    });
    await server.subscribe(async () => ({ ok: true, value: 1 }));

    await transport.deliver("requests", requestPayload(), "replies.hinted");
    expect(transport.published[0]?.destination).toBe("replies.hinted");
    await server.close();
  });

  test("nacks a request whose reply cannot be published", async () => {
    const transport = new FakeTransport();
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
    });
    await server.subscribe(async () => ({ ok: true, value: 1 }));
    transport.failPublish = new AponiaError("MICROSERVICE_DELIVERY_FAILED", "failed", {
      transport: "fake",
      operation: "publish",
    });

    expect(await transport.deliver("requests", requestPayload())).toBe("nack");
    await server.close();
  });

  test("acks when a malformed request cannot be answered", async () => {
    const transport = new FakeTransport();
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
      replyDestinations: ["replies.client"],
    });
    await server.subscribe(async () => ({ ok: true, value: 1 }));
    transport.failPublish = new AponiaError("MICROSERVICE_DELIVERY_FAILED", "failed", {
      transport: "fake",
      operation: "publish",
    });

    const malformed = encode({
      v: 1,
      kind: "request",
      id: "req-1",
      pattern: "users.findOne",
      target: "default",
      replyTo: "replies.client",
      data: {},
      extra: true,
    });
    expect(await transport.deliver("requests", malformed)).toBe("ack");
    await server.close();
  });

  test("answers with a handler error when the value cannot be encoded", async () => {
    const transport = new FakeTransport();
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
    });
    await server.subscribe(async () => ({ ok: true, value: () => undefined }));

    await transport.deliver("requests", requestPayload());
    const reply = decodedReply(transport.published[0]?.payload ?? new Uint8Array());
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.code).toBe("MESSAGE_HANDLER_ERROR");
    }
    await server.close();
  });

  test("reports close failures without stopping teardown", async () => {
    const transport = new FakeTransport();
    const messages: string[] = [];
    const server = createMicroserviceServer({
      transport,
      subscriptions: [{ destination: "requests" }],
      logger: {
        log: () => undefined,
        fatal: () => undefined,
        error: (message) => {
          messages.push(String(message));
        },
        warn: () => undefined,
      },
      closeTimeoutMs: 10,
    });
    await server.subscribe(async () => ({ ok: true, value: 1 }));
    transport.failSubscriptionClose = true;
    transport.failClose = true;

    await server.close();
    expect(messages).toContain("A microservice subscription did not close cleanly.");
    expect(messages).toContain("The microservice transport did not close cleanly.");
  });

  test("reports non-string identity and reply-destination options", () => {
    const transport = new FakeTransport();
    const invalid = [
      { transport, subscriptions: [{ destination: "requests" }], target: "" },
      { transport, subscriptions: [{ destination: "requests" }], name: "" },
      {
        transport,
        subscriptions: [{ destination: "requests", consumerGroup: "" }],
      },
      { transport, subscriptions: [{ destination: "requests" }], replyDestinations: "no" },
    ];
    for (const config of invalid) {
      const failure = (() => {
        try {
          createMicroserviceServer(config as never);
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      expect(failure).toBeInstanceOf(AponiaError);
      expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
    }
  });
});
