import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { RedisTransport, redisTransport } from "../src/brokers/redis/redis-transport.ts";
import type {
  RedisAutoClaimResult,
  RedisSdkClient,
  RedisSdkClientOptions,
  RedisSdkModule,
  RedisStreamMessage,
  RedisStreamReadResult,
  RedisTransportOptions,
} from "../src/brokers/redis/redis-transport.types.ts";
import type { TransportMessage } from "../src/transport/transport.types.ts";

const payload = new Uint8Array([1, 2, 3]);
const encodedPayload = Buffer.from(payload).toString("base64");

interface RecordedGroup {
  readonly key: string;
  readonly group: string;
  readonly id: string;
  readonly options: { readonly MKSTREAM?: boolean } | undefined;
}

interface RecordedRead {
  readonly group: string;
  readonly consumer: string;
  readonly streams: readonly { readonly key: string; readonly id: string }[];
  readonly options: { readonly COUNT?: number; readonly BLOCK?: number } | undefined;
}

interface SharedState {
  readonly events: string[];
  readonly groups: RecordedGroup[];
  readonly added: {
    readonly key: string;
    readonly id: string;
    readonly message: Readonly<Record<string, string>>;
  }[];
  readonly acks: { readonly key: string; readonly group: string; readonly id: string }[];
  readonly claims: {
    readonly key: string;
    readonly group: string;
    readonly consumer: string;
    readonly minIdleTime: number;
    readonly start: string;
    readonly options: { readonly COUNT?: number } | undefined;
  }[];
  readonly reads: RecordedRead[];
  readonly duplicates: FakeRedisClient[];
  readonly clientOptions: RedisSdkClientOptions[];
  readonly claimQueue: RedisAutoClaimResult[];
  readonly readQueue: (readonly RedisStreamReadResult[] | null)[];
  readonly pendingReads: ((value: readonly RedisStreamReadResult[] | null) => void)[];
  groupFailure: Error | undefined;
  busyGroups: boolean;
  readFailure: Error | undefined;
  failPublisherConnect: boolean;
  failDisconnect: boolean;
  claimGate: Promise<void> | undefined;
  publisher: FakeRedisClient | undefined;
}

function createState(): SharedState {
  return {
    events: [],
    groups: [],
    added: [],
    acks: [],
    claims: [],
    reads: [],
    duplicates: [],
    clientOptions: [],
    claimQueue: [],
    readQueue: [],
    pendingReads: [],
    groupFailure: undefined,
    busyGroups: false,
    readFailure: undefined,
    failPublisherConnect: false,
    failDisconnect: false,
    claimGate: undefined,
    publisher: undefined,
  };
}

class FakeRedisClient implements RedisSdkClient {
  readonly state: SharedState;
  readonly kind: "publisher" | "consumer";
  connects = 0;
  disconnects = 0;

  constructor(state: SharedState, kind: "publisher" | "consumer") {
    this.state = state;
    this.kind = kind;
  }

  async connect(): Promise<void> {
    this.connects += 1;
    this.state.events.push(`${this.kind}-connect`);
    if (this.kind === "publisher" && this.state.failPublisherConnect) {
      throw new Error("could not connect to the configured secret host");
    }
  }

  async disconnect(): Promise<void> {
    this.disconnects += 1;
    this.state.events.push(`${this.kind}-disconnect`);
    for (const resolve of this.state.pendingReads.splice(0)) {
      resolve(null);
    }
    if (this.state.failDisconnect) {
      throw new Error("disconnect failed");
    }
  }

  duplicate(): FakeRedisClient {
    const client = new FakeRedisClient(this.state, "consumer");
    this.state.duplicates.push(client);
    return client;
  }

  async xAdd(key: string, id: string, message: Readonly<Record<string, string>>): Promise<unknown> {
    this.state.added.push({ key, id, message });
    return "1-0";
  }

  async xAck(key: string, group: string, id: string): Promise<number> {
    this.state.acks.push({ key, group, id });
    return 1;
  }

  async xAutoClaim(
    key: string,
    group: string,
    consumer: string,
    minIdleTime: number,
    start: string,
    options?: { readonly COUNT?: number },
  ): Promise<RedisAutoClaimResult> {
    const gate = this.state.claimGate;
    if (gate !== undefined) {
      this.state.claimGate = undefined;
      await gate;
    }
    this.state.claims.push({ key, group, consumer, minIdleTime, start, options });
    return this.state.claimQueue.shift() ?? { nextId: "0-0", messages: [] };
  }

  async xGroupCreate(
    key: string,
    group: string,
    id: string,
    options?: { readonly MKSTREAM?: boolean },
  ): Promise<unknown> {
    this.state.groups.push({ key, group, id, options });
    if (this.state.groupFailure !== undefined) {
      throw this.state.groupFailure;
    }
    if (this.state.busyGroups) {
      throw new Error("BUSYGROUP Consumer Group name already exists");
    }
    return "OK";
  }

  async xReadGroup(
    group: string,
    consumer: string,
    streams: readonly { readonly key: string; readonly id: string }[],
    options?: { readonly COUNT?: number; readonly BLOCK?: number },
  ): Promise<readonly RedisStreamReadResult[] | null> {
    this.state.reads.push({ group, consumer, streams, options });
    if (this.state.readFailure !== undefined) {
      throw this.state.readFailure;
    }
    if (this.state.readQueue.length > 0) {
      return this.state.readQueue.shift() ?? null;
    }
    return new Promise((resolve) => {
      this.state.pendingReads.push(resolve);
    });
  }
}

function sdk(state: SharedState): RedisSdkModule {
  return {
    createClient: (options) => {
      state.clientOptions.push(options);
      const client = new FakeRedisClient(state, "publisher");
      state.publisher = client;
      return client;
    },
  };
}

function deliver(state: SharedState, messages: readonly RedisStreamMessage[]): void {
  deliverStreams(state, [{ name: "orders.requests", messages }]);
}

function deliverStreams(state: SharedState, streams: readonly RedisStreamReadResult[]): void {
  const resolve = state.pendingReads.shift();
  if (resolve === undefined) {
    state.readQueue.push(streams);
    return;
  }
  resolve(streams);
}

function message(
  id: string,
  value: Readonly<Record<string, string>> = { payload: encodedPayload },
): RedisStreamMessage {
  return { id, message: value };
}

async function settle(): Promise<void> {
  await Bun.sleep(0);
}

describe("Redis Streams transport", () => {
  test("loads the SDK only when the connection opens", async () => {
    const state = createState();
    let loads = 0;
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => {
      loads += 1;
      return sdk(state);
    });

    expect(loads).toBe(0);
    await transport.connect();
    expect(loads).toBe(1);
    expect(state.publisher?.connects).toBe(1);
    await transport.connect();
    expect(loads).toBe(1);
    expect(state.publisher?.connects).toBe(1);
    await transport.close();
  });

  test("connects with the URL and connect timeout", async () => {
    const state = createState();
    const transport = new RedisTransport(
      {
        url: "redis://cache:6379",
        connectTimeoutMs: 250,
        name: "orders-redis",
      },
      async () => sdk(state),
    );

    await transport.connect();
    expect(transport.name).toBe("orders-redis");
    expect(state.clientOptions).toEqual([
      { url: "redis://cache:6379", socket: { connectTimeout: 250 } },
    ]);
    await transport.close();
  });

  test("publishes one base64 payload field with XADD", async () => {
    const state = createState();
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => sdk(state));

    await transport.connect();
    await transport.publish("orders.requests", payload, "ignored-reply-stream");

    expect(state.added).toEqual([
      {
        key: "orders.requests",
        id: "*",
        message: { payload: encodedPayload },
      },
    ]);
    await transport.close();
  });

  test("creates a group on a duplicated client and acknowledges a delivery", async () => {
    const state = createState();
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => sdk(state));
    const seen: TransportMessage[] = [];

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, (messageSeen) => {
      seen.push(messageSeen);
      return "ack";
    });
    await settle();

    const group = state.groups[0];
    const consumer = state.duplicates[0];
    expect(group?.key).toBe("orders.requests");
    expect(group?.id).toBe("0");
    expect(group?.options).toEqual({ MKSTREAM: true });
    expect(consumer?.connects).toBe(1);
    const read = state.reads[0];
    expect(read?.group).toBe(group?.group);
    expect(read?.streams).toEqual([{ key: "orders.requests", id: ">" }]);
    expect(read?.options).toEqual({ COUNT: 10, BLOCK: 5_000 });

    deliver(state, [message("1-0")]);
    await settle();

    expect(seen).toEqual([{ payload }]);
    expect(state.acks).toEqual([{ key: "orders.requests", group: group?.group, id: "1-0" }]);
    await transport.close();
  });

  test("leaves a nacked or failed entry pending and keeps the lane moving", async () => {
    const state = createState();
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => sdk(state));
    let mode: "nack" | "throw" | "ack" = "nack";

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => {
      if (mode === "throw") {
        throw new Error("handler failed with a payload");
      }
      return mode;
    });
    await settle();

    deliver(state, [message("10-0")]);
    await settle();
    expect(state.acks).toEqual([]);

    mode = "throw";
    deliver(state, [message("11-0")]);
    await settle();
    expect(state.acks).toEqual([]);

    mode = "ack";
    deliver(state, [message("12-0")]);
    await settle();
    expect(state.acks).toEqual([
      { key: "orders.requests", group: state.groups[0]?.group, id: "12-0" },
    ]);
    await transport.close();
  });

  test("reclaims stale pending entries before each read", async () => {
    const state = createState();
    state.claimQueue.push({
      nextId: "0-0",
      messages: [message("9-0")],
    });
    const transport = new RedisTransport(
      { url: "redis://127.0.0.1:6379", batchSize: 4 },
      async () => sdk(state),
    );
    const seen: TransportMessage[] = [];

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, (messageSeen) => {
      seen.push(messageSeen);
      return "ack";
    });
    await settle();

    const group = state.groups[0]?.group;
    expect(state.claims[0]).toMatchObject({
      key: "orders.requests",
      group,
      minIdleTime: 60_000,
      start: "0-0",
      options: { COUNT: 4 },
    });
    expect(seen).toEqual([{ payload }]);
    expect(state.acks).toEqual([{ key: "orders.requests", group, id: "9-0" }]);
    await transport.close();
  });

  test("ignores BUSYGROUP and reports other group failures without SDK detail", async () => {
    const busyState = createState();
    busyState.busyGroups = true;
    const busyTransport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () =>
      sdk(busyState),
    );

    await busyTransport.connect();
    await busyTransport.subscribe({ destination: "orders.requests" }, () => "ack");
    expect(busyState.groups).toHaveLength(1);
    await busyTransport.close();

    const failingState = createState();
    failingState.groupFailure = new Error("ERR secret connection detail");
    const failingTransport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () =>
      sdk(failingState),
    );

    await failingTransport.connect();
    const failure = await failingTransport
      .subscribe({ destination: "orders.requests" }, () => "ack")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_DELIVERY_FAILED");
    expect((failure as AponiaError).message).not.toContain("secret connection detail");
    expect(failingState.duplicates[0]?.disconnects).toBe(1);
    await failingTransport.close();
  });

  test("stops a subscription after a failed read instead of rejecting", async () => {
    const state = createState();
    state.readFailure = new Error("ERR socket closed");
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => sdk(state));

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => "ack");
    await settle();
    expect(state.reads).toHaveLength(1);
    await transport.close();
  });

  test("does not call the handler for an undecodable payload", async () => {
    const state = createState();
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => sdk(state));
    let calls = 0;

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => {
      calls += 1;
      return "ack";
    });
    await settle();

    deliver(state, [message("2-0", { payload: "not base64 %%%" })]);
    deliver(state, [message("3-0", {})]);
    await settle();

    expect(calls).toBe(0);
    expect(state.acks).toEqual([]);
    await transport.close();
  });

  test("reads RESP3 map fields and binary field values", async () => {
    const state = createState();
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => sdk(state));
    const seen: TransportMessage[] = [];

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, (messageSeen) => {
      seen.push(messageSeen);
      return "ack";
    });
    await settle();

    deliver(state, [
      { id: "4-0", message: new Map([["payload", encodedPayload]]) },
      { id: "5-0", message: { payload: new TextEncoder().encode(encodedPayload) } },
    ]);
    await settle();

    expect(seen).toEqual([{ payload }, { payload }]);
    expect(state.acks.map((entry) => entry.id)).toEqual(["4-0", "5-0"]);
    await transport.close();
  });

  test("uses the subscription group and the configured batch and block bounds", async () => {
    const state = createState();
    const transport = new RedisTransport(
      {
        url: "redis://127.0.0.1:6379",
        consumerGroup: "orders-workers",
        consumerName: "orders-worker-1",
        blockMs: 25,
        batchSize: 3,
      },
      async () => sdk(state),
    );

    await transport.connect();
    await transport.subscribe(
      { destination: "orders.requests", consumerGroup: "orders-special" },
      () => "ack",
    );
    await settle();

    expect(state.groups[0]?.group).toBe("orders-special");
    expect(state.reads[0]?.consumer).toBe("orders-worker-1");
    expect(state.reads[0]?.options).toEqual({ COUNT: 3, BLOCK: 25 });
    await transport.close();

    const defaultState = createState();
    const first = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () =>
      sdk(defaultState),
    );
    await first.connect();
    await first.subscribe({ destination: "orders.requests" }, () => "ack");
    await settle();
    await first.close();

    const secondState = createState();
    const second = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () =>
      sdk(secondState),
    );
    await second.connect();
    await second.subscribe({ destination: "orders.requests" }, () => "ack");
    await settle();
    await second.close();

    expect(defaultState.groups[0]?.group).not.toBe(secondState.groups[0]?.group);
    expect(defaultState.reads[0]?.consumer).not.toBe(secondState.reads[0]?.consumer);
  });

  test("closes subscription clients before the publisher and is idempotent", async () => {
    const state = createState();
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => sdk(state));

    await transport.connect();
    const handle = await transport.subscribe({ destination: "orders.requests" }, () => "ack");
    await settle();
    await handle.close();
    await handle.close();
    expect(state.duplicates[0]?.disconnects).toBe(1);

    await transport.subscribe({ destination: "orders.events" }, () => "ack");
    await settle();
    await transport.close();
    await transport.close();

    expect(state.duplicates[1]?.disconnects).toBe(1);
    expect(state.publisher?.disconnects).toBe(1);
    expect(state.events.slice(-2)).toEqual(["consumer-disconnect", "publisher-disconnect"]);
  });

  test("sanitizes a publisher connect failure and disconnects the client", async () => {
    const state = createState();
    state.failPublisherConnect = true;
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => sdk(state));

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({ transport: "redis", operation: "connect" });
    expect((failure as AponiaError).message).not.toContain("secret host");
    expect(state.publisher?.disconnects).toBe(1);
  });

  test("stops a claimed dispatch when close runs during the claim", async () => {
    const state = createState();
    let releaseClaim: (() => void) | undefined;
    state.claimGate = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => sdk(state));

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => "ack");
    await settle();

    const closing = transport.close();
    releaseClaim?.();
    await closing;
    await settle();

    expect(state.reads).toEqual([]);
    expect(state.acks).toEqual([]);
  });

  test("does not acknowledge a delivery when close runs inside the handler", async () => {
    const state = createState();
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => sdk(state));
    let closing: Promise<void> | undefined;
    let calls = 0;

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => {
      calls += 1;
      closing = transport.close();
      return "ack";
    });
    await settle();

    deliver(state, [message("20-0")]);
    await settle();
    await closing;

    expect(calls).toBe(1);
    expect(state.acks).toEqual([]);
  });

  test("stops a claimed dispatch when close runs inside the handler", async () => {
    const state = createState();
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => sdk(state));
    let closing: Promise<void> | undefined;
    let calls = 0;

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => {
      calls += 1;
      closing = transport.close();
      return "ack";
    });
    await settle();

    state.claimQueue.push({
      nextId: "0-0",
      messages: [message("25-0")],
    });
    const pending = state.pendingReads.shift();
    pending?.(null);
    await settle();
    await closing;

    expect(calls).toBe(1);
    expect(state.acks).toEqual([]);
  });

  test("stops after the current stream when close runs inside the handler", async () => {
    const state = createState();
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => sdk(state));
    let closing: Promise<void> | undefined;
    let calls = 0;

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => {
      calls += 1;
      closing = transport.close();
      return "ack";
    });
    await settle();

    deliverStreams(state, [
      { name: "orders.requests", messages: [message("30-0")] },
      { name: "orders.requests", messages: [message("31-0")] },
    ]);
    await settle();
    await closing;

    expect(calls).toBe(1);
    expect(state.acks).toEqual([]);
  });

  test("skips a null reclaimed entry and dispatches the next one", async () => {
    const state = createState();
    state.claimQueue.push({
      nextId: "0-0",
      messages: [null, message("40-0")],
    });
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => sdk(state));
    let calls = 0;

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => {
      calls += 1;
      return "ack";
    });
    await settle();

    expect(calls).toBe(1);
    expect(state.acks).toEqual([
      { key: "orders.requests", group: state.groups[0]?.group, id: "40-0" },
    ]);
    await transport.close();
  });

  test("tolerates a failing disconnect during close", async () => {
    const state = createState();
    state.failDisconnect = true;
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => sdk(state));

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => "ack");
    await settle();
    await transport.close();
    await transport.close();

    expect(state.duplicates[0]?.disconnects).toBe(1);
    expect(state.publisher?.disconnects).toBe(1);
  });

  test("reports the missing package without exposing the loader failure", async () => {
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => {
      throw new Error("cannot resolve redis from /secret/path");
    });

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({ transport: "redis", package: "redis" });
    expect((failure as AponiaError).message).not.toContain("/secret/path");
  });

  test("rejects an SDK that does not expose createClient", async () => {
    const transport = new RedisTransport(
      { url: "redis://127.0.0.1:6379" },
      async () => ({ createClient: 42 }) as unknown as RedisSdkModule,
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({ transport: "redis", package: "redis" });
  });

  test("rejects a client that does not expose connect", async () => {
    const transport = new RedisTransport(
      { url: "redis://127.0.0.1:6379" },
      async () =>
        ({
          createClient: () => ({}),
        }) as unknown as RedisSdkModule,
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({ transport: "redis", package: "redis" });
  });

  test("rejects invalid options before a connection opens", () => {
    const invalid = [
      {},
      { url: "" },
      { url: "redis://cache with space:6379" },
      { url: "redis://127.0.0.1:6379", consumerGroup: "bad group" },
      { url: "redis://127.0.0.1:6379", consumerName: "bad name" },
      { url: "redis://127.0.0.1:6379", blockMs: 0 },
      { url: "redis://127.0.0.1:6379", batchSize: 1.5 },
      { url: "redis://127.0.0.1:6379", connectTimeoutMs: -1 },
      { url: "redis://127.0.0.1:6379", name: "a b" },
    ];

    for (const options of invalid) {
      const failure = (() => {
        try {
          new RedisTransport(options as unknown as RedisTransportOptions);
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      expect(failure).toBeInstanceOf(AponiaError);
      expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
    }
  });

  test("refuses operations before connect and after close", async () => {
    const state = createState();
    const transport = new RedisTransport({ url: "redis://127.0.0.1:6379" }, async () => sdk(state));

    const before = await transport
      .publish("orders.requests", payload)
      .catch((error: unknown) => error);
    expect(before).toBeInstanceOf(AponiaError);
    expect((before as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");

    await transport.connect();
    await transport.close();
    const after = await transport
      .publish("orders.requests", payload)
      .catch((error: unknown) => error);
    expect(after).toBeInstanceOf(AponiaError);
    expect((after as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect(transport.connect()).rejects.toBeInstanceOf(AponiaError);
  });

  test("builds the public factory", () => {
    expect(redisTransport({ url: "redis://127.0.0.1:6379" }).name).toBe("redis");
  });
});
