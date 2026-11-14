import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import {
  RabbitMqTransport,
  rabbitmqTransport,
} from "../src/brokers/rabbitmq/rabbitmq-transport.ts";
import type {
  RabbitMqSdkConnection,
  RabbitMqSdkConsumer,
  RabbitMqSdkConsumerCallback,
  RabbitMqSdkConsumerOptions,
  RabbitMqSdkConsumerStatus,
  RabbitMqSdkConstructor,
  RabbitMqSdkModule,
  RabbitMqSdkPublisher,
  RabbitMqSdkPublisherOptions,
} from "../src/brokers/rabbitmq/rabbitmq-transport.types.ts";
import type { TransportMessage } from "../src/transport/transport.types.ts";

const request = new Uint8Array([1, 2, 3]);
const reply = new Uint8Array([4, 5, 6]);

type Listener = (...args: never[]) => void;

class FakeRabbitPublisher implements RabbitMqSdkPublisher {
  readonly sent: { readonly queue: string; readonly body: Uint8Array }[] = [];
  readonly #events: string[];
  closeCalls = 0;
  closeFailure: Error | undefined;

  constructor(events: string[]) {
    this.#events = events;
  }

  send(queue: string, body: Uint8Array): Promise<void> {
    this.sent.push({ queue, body });
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.#events.push("publisher-close");
    if (this.closeFailure !== undefined) {
      return Promise.reject(this.closeFailure);
    }
    return Promise.resolve();
  }
}

class FakeRabbitConsumer implements RabbitMqSdkConsumer {
  readonly #events: string[];
  closeCalls = 0;
  closeFailure: Error | undefined;

  constructor(events: string[]) {
    this.#events = events;
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.#events.push("consumer-close");
    if (this.closeFailure !== undefined) {
      return Promise.reject(this.closeFailure);
    }
    return Promise.resolve();
  }
}

class FakeRabbitConnection implements RabbitMqSdkConnection {
  readonly events: string[] = [];
  readonly consumers: {
    readonly options: RabbitMqSdkConsumerOptions;
    readonly callback: RabbitMqSdkConsumerCallback;
    readonly handle: FakeRabbitConsumer;
  }[] = [];
  readonly publisherProps: RabbitMqSdkPublisherOptions[] = [];
  readonly publisher = new FakeRabbitPublisher(this.events);
  readonly onConnectArgs: number[] = [];
  readonly #listeners = new Map<string, Set<Listener>>();
  onConnectFailure: Error | undefined;
  publisherOverride: RabbitMqSdkPublisher | undefined;
  closeCalls = 0;
  closeFailure: Error | undefined;

  onConnect(timeout?: number): Promise<void> {
    if (timeout !== undefined) {
      this.onConnectArgs.push(timeout);
    }
    if (this.onConnectFailure !== undefined) {
      return Promise.reject(this.onConnectFailure);
    }
    return Promise.resolve();
  }

  on(event: string, listener: Listener): void {
    let listeners = this.#listeners.get(event);
    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(event, listeners);
    }
    listeners.add(listener);
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.events.push("connection-close");
    if (this.closeFailure !== undefined) {
      return Promise.reject(this.closeFailure);
    }
    return Promise.resolve();
  }

  createPublisher(options: RabbitMqSdkPublisherOptions): RabbitMqSdkPublisher {
    this.publisherProps.push(options);
    return this.publisherOverride ?? this.publisher;
  }

  createConsumer(
    options: RabbitMqSdkConsumerOptions,
    callback: RabbitMqSdkConsumerCallback,
  ): RabbitMqSdkConsumer {
    const handle = new FakeRabbitConsumer(this.events);
    this.consumers.push({ options, callback, handle });
    return handle;
  }

  listenerCount(event: string): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of Array.from(this.#listeners.get(event) ?? [])) {
      listener(...(args as never[]));
    }
  }
}

interface SeenConstructor {
  url: string | undefined;
  options: { readonly connectionTimeout?: number } | undefined;
}

const defaultStatus: RabbitMqSdkConsumerStatus = { ACK: 0, REQUEUE: 1, DROP: 2 };

function moduleFor(
  connection: FakeRabbitConnection,
  seen: SeenConstructor = { url: undefined, options: undefined },
  status: RabbitMqSdkConsumerStatus = defaultStatus,
): RabbitMqSdkModule {
  const Connection = function (
    this: unknown,
    url: string,
    options?: { readonly connectionTimeout?: number },
  ): FakeRabbitConnection {
    seen.url = url;
    seen.options = options;
    return connection;
  } as unknown as RabbitMqSdkConstructor;
  return { default: Connection, ConsumerStatus: status };
}

function firstConsumer(connection: FakeRabbitConnection): {
  readonly options: RabbitMqSdkConsumerOptions;
  readonly callback: RabbitMqSdkConsumerCallback;
  readonly handle: FakeRabbitConsumer;
} {
  const consumer = connection.consumers[0];
  if (consumer === undefined) {
    throw new Error("the transport did not create a consumer");
  }
  return consumer;
}

describe("RabbitMQ transport", () => {
  test("loads the SDK only when the connection opens", async () => {
    const connection = new FakeRabbitConnection();
    let loads = 0;
    const transport = new RabbitMqTransport({ url: "amqp://broker:5672" }, () => {
      loads += 1;
      return Promise.resolve(moduleFor(connection));
    });

    expect(loads).toBe(0);
    await transport.connect();
    expect(loads).toBe(1);
    await transport.connect();
    expect(loads).toBe(1);
    await transport.close();
  });

  test("connects with the URL, timeout, and one confirmed publisher", async () => {
    const connection = new FakeRabbitConnection();
    const seen: SeenConstructor = { url: undefined, options: undefined };
    const transport = new RabbitMqTransport(
      {
        url: "amqp://broker:5672",
        prefetch: 16,
        connectTimeoutMs: 250,
        name: "orders-rabbitmq",
      },
      async () => moduleFor(connection, seen),
    );

    await transport.connect();
    expect(transport.name).toBe("orders-rabbitmq");
    expect(seen.url).toBe("amqp://broker:5672");
    expect(seen.options).toEqual({ connectionTimeout: 250 });
    expect(connection.onConnectArgs).toEqual([250]);
    expect(connection.publisherProps).toEqual([{ confirm: true }]);
    expect(connection.listenerCount("error")).toBe(1);
    expect(() => connection.emit("error", new Error("socket error"))).not.toThrow();
    await transport.close();
  });

  test("applies the default connect timeout and prefetch count", async () => {
    const connection = new FakeRabbitConnection();
    const seen: SeenConstructor = { url: undefined, options: undefined };
    const transport = new RabbitMqTransport({ url: "amqp://broker:5672" }, async () =>
      moduleFor(connection, seen),
    );

    await transport.connect();
    expect(seen.options).toEqual({ connectionTimeout: 10_000 });
    expect(connection.onConnectArgs).toEqual([10_000]);
    await transport.subscribe({ destination: "orders.requests" }, () => "ack");
    expect(firstConsumer(connection).options).toEqual({
      queue: "orders.requests",
      qos: { prefetchCount: 64 },
    });
    await transport.close();
  });

  test("publishes the envelope to a queue", async () => {
    const connection = new FakeRabbitConnection();
    const transport = new RabbitMqTransport({ url: "amqp://broker:5672" }, async () =>
      moduleFor(connection),
    );

    await transport.connect();
    await transport.publish("orders.requests", request, "orders.replies.one");
    await transport.publish("orders.replies.one", reply);

    expect(connection.publisher.sent).toEqual([
      { queue: "orders.requests", body: request },
      { queue: "orders.replies.one", body: reply },
    ]);
    await transport.close();
  });

  test("maps handler decisions to the SDK consumer status", async () => {
    const connection = new FakeRabbitConnection();
    const transport = new RabbitMqTransport({ url: "amqp://broker:5672" }, async () =>
      moduleFor(connection),
    );
    const seen: TransportMessage[] = [];
    let decision: "ack" | "nack" = "ack";
    let shouldThrow = false;

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, (message) => {
      seen.push(message);
      if (shouldThrow) {
        throw new Error("handler failed");
      }
      return decision;
    });
    const consumer = firstConsumer(connection);

    expect(await consumer.callback({ body: request })).toBe(0);
    decision = "nack";
    expect(await consumer.callback({ body: reply })).toBe(1);
    shouldThrow = true;
    expect(await consumer.callback({ body: request })).toBe(1);
    expect(await consumer.callback({ body: "text" as unknown as Uint8Array })).toBe(0);
    expect(seen).toEqual([{ payload: request }, { payload: reply }, { payload: request }]);
    await transport.close();
  });

  test("reads the status values the loaded SDK exposes", async () => {
    const connection = new FakeRabbitConnection();
    const transport = new RabbitMqTransport({ url: "amqp://broker:5672" }, async () =>
      moduleFor(
        connection,
        { url: undefined, options: undefined },
        {
          ACK: 7,
          REQUEUE: 9,
          DROP: 3,
        },
      ),
    );
    let decision: "ack" | "nack" = "ack";

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => decision);
    const consumer = firstConsumer(connection);

    expect(await consumer.callback({ body: request })).toBe(7);
    decision = "nack";
    expect(await consumer.callback({ body: request })).toBe(9);
    await transport.close();
  });

  test("closes the subscription, publisher, and connection idempotently", async () => {
    const connection = new FakeRabbitConnection();
    const transport = new RabbitMqTransport({ url: "amqp://broker:5672" }, async () =>
      moduleFor(connection),
    );

    await transport.connect();
    const handle = await transport.subscribe({ destination: "orders.requests" }, () => "ack");
    await handle.close();
    await handle.close();
    expect(firstConsumer(connection).handle.closeCalls).toBe(1);

    await transport.close();
    await transport.close();
    expect(connection.publisher.closeCalls).toBe(1);
    expect(connection.closeCalls).toBe(1);
    expect(connection.events).toEqual(["consumer-close", "publisher-close", "connection-close"]);
  });

  test("releases every resource when each SDK close fails", async () => {
    const connection = new FakeRabbitConnection();
    connection.publisher.closeFailure = new Error("publisher close failed");
    connection.closeFailure = new Error("connection close failed");
    const transport = new RabbitMqTransport({ url: "amqp://broker:5672" }, async () =>
      moduleFor(connection),
    );

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => "ack");
    firstConsumer(connection).handle.closeFailure = new Error("consumer close failed");

    await transport.close();
    expect(connection.publisher.closeCalls).toBe(1);
    expect(connection.closeCalls).toBe(1);
    expect(connection.events).toEqual(["consumer-close", "publisher-close", "connection-close"]);
  });

  test("closing before connect releases nothing", async () => {
    let loads = 0;
    const transport = new RabbitMqTransport({ url: "amqp://broker:5672" }, () => {
      loads += 1;
      return Promise.resolve(moduleFor(new FakeRabbitConnection()));
    });

    await transport.close();
    await transport.close();
    expect(loads).toBe(0);
  });

  test("rejects a publisher without the required shape and closes the connection", async () => {
    const overrides = [{ close: () => Promise.resolve() }, 42] as unknown as RabbitMqSdkPublisher[];
    for (const publisherOverride of overrides) {
      const connection = new FakeRabbitConnection();
      connection.publisherOverride = publisherOverride;
      const transport = new RabbitMqTransport({ url: "amqp://broker:5672" }, async () =>
        moduleFor(connection),
      );

      const failure = await transport.connect().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AponiaError);
      expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
      expect(connection.closeCalls).toBe(1);
    }
  });

  test("rejects a consumer without the required shape", async () => {
    const connection = new FakeRabbitConnection();
    connection.createConsumer = () => ({}) as unknown as RabbitMqSdkConsumer;
    const transport = new RabbitMqTransport({ url: "amqp://broker:5672" }, async () =>
      moduleFor(connection),
    );

    await transport.connect();
    const failure = await transport
      .subscribe({ destination: "orders.requests" }, () => "ack")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    await transport.close();
  });

  test("rejects a connect failure and releases the connection", async () => {
    const connection = new FakeRabbitConnection();
    connection.onConnectFailure = new Error("authentication failed for amqp://broker:5672");
    const transport = new RabbitMqTransport({ url: "amqp://broker:5672" }, async () =>
      moduleFor(connection),
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).message).not.toContain("amqp://broker:5672");
    expect(connection.closeCalls).toBe(1);
  });

  test("sanitizes a constructor failure", async () => {
    const transport = new RabbitMqTransport(
      { url: "amqp://broker:5672" },
      async () =>
        ({
          default: function (): never {
            throw new Error("cannot parse amqp://broker:5672");
          },
          ConsumerStatus: defaultStatus,
        }) as unknown as RabbitMqSdkModule,
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).message).not.toContain("amqp://broker:5672");
  });

  test("reports the missing package without exposing the loader failure", async () => {
    const transport = new RabbitMqTransport({ url: "amqp://broker:5672" }, () =>
      Promise.reject(new Error("cannot resolve rabbitmq-client from /secret/path")),
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({
      transport: "rabbitmq",
      package: "rabbitmq-client",
    });
    expect((failure as AponiaError).message).not.toContain("/secret/path");
  });

  test("reports a module or connection without the required shape", async () => {
    const connection = new FakeRabbitConnection();
    const seen: SeenConstructor = { url: undefined, options: undefined };
    const withoutConstructor = new RabbitMqTransport(
      { url: "amqp://broker:5672" },
      async () => ({}),
    );
    const notCallable = new RabbitMqTransport(
      { url: "amqp://broker:5672" },
      async () => ({ default: 42 }) as unknown as RabbitMqSdkModule,
    );
    const withoutStatus = new RabbitMqTransport(
      { url: "amqp://broker:5672" },
      async () =>
        ({
          default: moduleFor(connection, seen).default,
        }) as unknown as RabbitMqSdkModule,
    );
    const incompleteConnection = new RabbitMqTransport(
      { url: "amqp://broker:5672" },
      async () =>
        ({
          default: function (): unknown {
            return { on: () => undefined, close: () => Promise.resolve() };
          },
          ConsumerStatus: defaultStatus,
        }) as unknown as RabbitMqSdkModule,
    );
    const notAConnection = new RabbitMqTransport(
      { url: "amqp://broker:5672" },
      async () =>
        ({
          default: function (): number {
            return 42;
          },
          ConsumerStatus: defaultStatus,
        }) as unknown as RabbitMqSdkModule,
    );

    for (const transport of [
      withoutConstructor,
      notCallable,
      withoutStatus,
      incompleteConnection,
      notAConnection,
    ]) {
      const failure = await transport.connect().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AponiaError);
      expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
      expect((failure as AponiaError).details).toEqual({
        transport: "rabbitmq",
        package: "rabbitmq-client",
      });
    }
    expect(seen.url).toBeUndefined();
  });

  test("refuses invalid options before a connection opens", () => {
    for (const options of [
      {},
      { url: " " },
      { url: "amqp://broker:5672", prefetch: 0 },
      { url: "amqp://broker:5672", connectTimeoutMs: 0 },
      { url: "amqp://broker:5672", name: "orders rabbit" },
    ]) {
      const failure = (() => {
        try {
          new RabbitMqTransport(options as never);
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
    const connection = new FakeRabbitConnection();
    const transport = new RabbitMqTransport({ url: "amqp://broker:5672" }, async () =>
      moduleFor(connection),
    );

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
    const reconnect = await transport.connect().catch((error: unknown) => error);
    expect(reconnect).toBeInstanceOf(AponiaError);
  });

  test("rejects an invalid subscription destination before the SDK sees it", async () => {
    const connection = new FakeRabbitConnection();
    const transport = new RabbitMqTransport({ url: "amqp://broker:5672" }, async () =>
      moduleFor(connection),
    );

    await transport.connect();
    const failure = await transport
      .subscribe({ destination: "orders/#" }, () => "ack")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
    expect(connection.consumers).toEqual([]);
    await transport.close();
  });

  test("builds the public factory", () => {
    expect(rabbitmqTransport({ url: "amqp://broker:5672" }).name).toBe("rabbitmq");
    expect(rabbitmqTransport({ url: "amqp://broker:5672", name: "orders" }).name).toBe("orders");
  });
});
