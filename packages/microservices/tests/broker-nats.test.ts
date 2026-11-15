import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { NatsTransport, natsTransport } from "../src/brokers/nats/nats-transport.ts";
import type {
  NatsSdkConnection,
  NatsSdkConnectOptions,
  NatsSdkModule,
} from "../src/brokers/nats/nats-transport.types.ts";
import type { TransportMessage } from "../src/transport/transport.types.ts";

const request = new Uint8Array([1, 2, 3]);
const reply = new Uint8Array([4, 5, 6]);

class FakeNatsSubscription {
  drainCalls = 0;
  unsubscribed = false;

  async drain(): Promise<void> {
    this.drainCalls += 1;
  }

  unsubscribe(): void {
    this.unsubscribed = true;
  }
}

class FakeNatsConnection implements NatsSdkConnection {
  readonly published: {
    readonly subject: string;
    readonly payload: Uint8Array | undefined;
    readonly reply: string | undefined;
  }[] = [];
  readonly subscriptions: {
    readonly subject: string;
    readonly queue: string | undefined;
    readonly handle: FakeNatsSubscription;
    readonly callback: (
      error: Error | null,
      message: { readonly data: Uint8Array; readonly reply?: string; readonly subject: string },
    ) => void;
  }[] = [];
  drainCalls = 0;
  closeCalls = 0;

  publish(subject: string, payload?: Uint8Array, options?: { readonly reply?: string }): void {
    this.published.push({ subject, payload, reply: options?.reply });
  }

  subscribe(
    subject: string,
    options: {
      readonly queue?: string;
      readonly callback: (
        error: Error | null,
        message: { readonly data: Uint8Array; readonly reply?: string; readonly subject: string },
      ) => void;
    },
  ): FakeNatsSubscription {
    const handle = new FakeNatsSubscription();
    this.subscriptions.push({
      subject,
      queue: options.queue,
      handle,
      callback: options.callback,
    });
    return handle;
  }

  async drain(): Promise<void> {
    this.drainCalls += 1;
  }

  close(): void {
    this.closeCalls += 1;
  }
}

function sdk(connection: FakeNatsConnection, onConnect?: (options: NatsSdkConnectOptions) => void) {
  return async (): Promise<NatsSdkModule> => ({
    connect: async (options) => {
      onConnect?.(options);
      return connection;
    },
  });
}

describe("NATS transport", () => {
  test("loads the SDK only when the connection opens", async () => {
    const connection = new FakeNatsConnection();
    let loads = 0;
    const transport = new NatsTransport({}, async () => {
      loads += 1;
      return sdk(connection)();
    });

    expect(loads).toBe(0);
    await transport.connect();
    expect(loads).toBe(1);
    await transport.connect();
    expect(loads).toBe(1);
    await transport.close();
  });

  test("connects with the resolved servers, credentials, and timeout", async () => {
    const connection = new FakeNatsConnection();
    let options: NatsSdkConnectOptions | undefined;
    const transport = new NatsTransport(
      {
        servers: ["nats://first:4222", "nats://second:4222"],
        user: "service",
        pass: "secret",
        connectTimeoutMs: 250,
        name: "orders-nats",
      },
      sdk(connection, (seen) => {
        options = seen;
      }),
    );

    await transport.connect();
    expect(transport.name).toBe("orders-nats");
    expect(options).toEqual({
      servers: ["nats://first:4222", "nats://second:4222"],
      timeout: 250,
      name: "orders-nats",
      user: "service",
      pass: "secret",
    });
    await transport.close();
  });

  test("publishes the envelope and the reply subject", async () => {
    const connection = new FakeNatsConnection();
    const transport = new NatsTransport({}, sdk(connection));

    await transport.connect();
    await transport.publish("orders.requests", request, "orders.replies.one");
    await transport.publish("orders.events", reply);

    expect(connection.published).toEqual([
      { subject: "orders.requests", payload: request, reply: "orders.replies.one" },
      { subject: "orders.events", payload: reply, reply: undefined },
    ]);
    await transport.close();
  });

  test("delivers a payload and its reply subject to the handler", async () => {
    const connection = new FakeNatsConnection();
    const transport = new NatsTransport({}, sdk(connection));
    const seen: TransportMessage[] = [];

    await transport.connect();
    const handle = await transport.subscribe(
      { destination: "orders.requests", consumerGroup: "orders-workers" },
      async (message): Promise<"nack"> => {
        seen.push(message);
        return "nack";
      },
    );

    expect(connection.subscriptions[0]?.subject).toBe("orders.requests");
    expect(connection.subscriptions[0]?.queue).toBe("orders-workers");
    connection.subscriptions[0]?.callback(null, {
      data: request,
      reply: "orders.replies.one",
      subject: "orders.requests",
    });
    connection.subscriptions[0]?.callback(new Error("late"), {
      data: reply,
      subject: "orders.requests",
    });
    await Bun.sleep(0);

    expect(seen).toEqual([{ payload: request, replyTo: "orders.replies.one" }]);
    await handle.close();
    await handle.close();
    expect(connection.subscriptions[0]?.handle.drainCalls).toBe(1);
    await transport.close();
  });

  test("drains subscriptions and the connection on close", async () => {
    const connection = new FakeNatsConnection();
    const transport = new NatsTransport({}, sdk(connection));

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => "ack");
    await transport.close();
    await transport.close();

    expect(connection.subscriptions[0]?.handle.drainCalls).toBe(1);
    expect(connection.drainCalls).toBe(1);
  });

  test("reports the missing package without exposing the loader failure", async () => {
    const transport = new NatsTransport({}, async () => {
      throw new Error("cannot resolve nats from /secret/path");
    });

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({ transport: "nats", package: "nats" });
    expect((failure as AponiaError).message).not.toContain("/secret/path");
  });

  test("rejects an SDK that does not expose connect", async () => {
    const transport = new NatsTransport(
      {},
      async () => ({ connect: 42 }) as unknown as NatsSdkModule,
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({ transport: "nats", package: "nats" });
  });

  test("refuses invalid options before a connection opens", () => {
    expect(AponiaError).toBeDefined();
    for (const options of [
      { servers: [] as string[] },
      { servers: "nats server" },
      { servers: "" },
      { servers: "nats://a..b" },
      { user: " " },
      { name: "bad\u0000name" },
      { name: "a b" },
      { connectTimeoutMs: 0 },
    ]) {
      const failure = (() => {
        try {
          new NatsTransport(options);
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
    const connection = new FakeNatsConnection();
    const transport = new NatsTransport({}, sdk(connection));

    const before = await transport
      .publish("orders.requests", request)
      .catch((error: unknown) => error);
    expect(before).toBeInstanceOf(AponiaError);
    expect((before as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");

    await transport.connect();
    await transport.close();
    const after = await transport
      .publish("orders.requests", request)
      .catch((error: unknown) => error);
    expect(after).toBeInstanceOf(AponiaError);
    expect((after as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect(transport.connect()).rejects.toBeInstanceOf(AponiaError);
  });

  test("refuses a consumer group outside the shared broker grammar", async () => {
    const connection = new FakeNatsConnection();
    const transport = new NatsTransport({}, sdk(connection));
    await transport.connect();

    const failure = await transport
      .subscribe({ destination: "orders.requests", consumerGroup: "orders/workers" }, () => "ack")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
    expect(connection.subscriptions).toEqual([]);

    const empty = await transport
      .subscribe({ destination: "orders.requests", consumerGroup: "" }, () => "ack")
      .catch((error: unknown) => error);
    expect((empty as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
    await transport.close();
  });

  test("builds the public factory", () => {
    expect(natsTransport({ name: "orders" }).name).toBe("orders");
  });
});
