import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { KafkaTransport, kafkaTransport } from "../src/brokers/kafka/kafka-transport.ts";
import type {
  KafkaEachMessagePayload,
  KafkaOffset,
  KafkaProducerSendOptions,
  KafkaSdkClient,
  KafkaSdkClientOptions,
  KafkaSdkConsumer,
  KafkaSdkModule,
  KafkaSdkProducer,
  KafkaTopicPartition,
  KafkaTransportOptions,
} from "../src/brokers/kafka/kafka-transport.types.ts";
import type { TransportMessage } from "../src/transport/transport.types.ts";

const payload = new Uint8Array([1, 2, 3]);

class FakeProducer implements KafkaSdkProducer {
  readonly sent: KafkaProducerSendOptions[] = [];
  connects = 0;
  disconnects = 0;
  failConnect = false;
  failDisconnect = false;
  readonly events: string[];

  constructor(events: string[]) {
    this.events = events;
  }

  async connect(): Promise<void> {
    this.connects += 1;
    if (this.failConnect) {
      throw new Error("producer could not connect to broker:9092");
    }
  }

  async send(options: KafkaProducerSendOptions): Promise<unknown> {
    this.sent.push(options);
    return undefined;
  }

  async disconnect(): Promise<void> {
    this.disconnects += 1;
    this.events.push("producer-disconnect");
    if (this.failDisconnect) {
      throw new Error("producer disconnect failed");
    }
  }
}

class FakeConsumer implements KafkaSdkConsumer {
  readonly groupId: string;
  readonly events: string[];
  readonly subscriptions: { readonly topic: string; readonly fromBeginning: boolean }[] = [];
  readonly pauses: KafkaTopicPartition[] = [];
  readonly commits: KafkaOffset[] = [];
  connects = 0;
  disconnects = 0;
  failConnect = false;
  failPause = false;
  failDisconnect = false;
  failRun = false;
  failCommit = false;
  runOptions:
    | {
        readonly autoCommit: false;
        readonly eachMessage: (payload: KafkaEachMessagePayload) => Promise<void>;
      }
    | undefined;

  constructor(groupId: string, events: string[]) {
    this.groupId = groupId;
    this.events = events;
  }

  async connect(): Promise<void> {
    this.connects += 1;
    if (this.failConnect) {
      throw new Error("consumer could not connect to broker:9092");
    }
  }

  async subscribe(options: {
    readonly topic: string;
    readonly fromBeginning: boolean;
  }): Promise<void> {
    this.subscriptions.push(options);
  }

  async run(options: {
    readonly autoCommit: false;
    readonly eachMessage: (payload: KafkaEachMessagePayload) => Promise<void>;
  }): Promise<void> {
    this.runOptions = options;
    if (this.failRun) {
      throw new Error("consumer loop failed with a connection string");
    }
  }

  pause(topics: readonly KafkaTopicPartition[]): void {
    this.pauses.push(...topics);
    if (this.failPause) {
      throw new Error("pause failed");
    }
  }

  async commitOffsets(offsets: readonly KafkaOffset[]): Promise<void> {
    if (this.failCommit) {
      throw new Error("commit failed");
    }
    this.commits.push(...offsets);
  }

  async disconnect(): Promise<void> {
    this.disconnects += 1;
    this.events.push("consumer-disconnect");
    if (this.failDisconnect) {
      throw new Error("consumer disconnect failed");
    }
  }
}

class FakeKafkaClient implements KafkaSdkClient {
  readonly producerInstance: FakeProducer;
  readonly consumers: FakeConsumer[] = [];
  readonly events: string[] = [];
  readonly optionsSeen: KafkaSdkClientOptions[] = [];
  failNextRun = false;
  failNextConsumerConnect = false;

  constructor() {
    this.producerInstance = new FakeProducer(this.events);
  }

  producer(): FakeProducer {
    return this.producerInstance;
  }

  consumer(options: { readonly groupId: string }): FakeConsumer {
    const consumer = new FakeConsumer(options.groupId, this.events);
    consumer.failRun = this.failNextRun;
    consumer.failConnect = this.failNextConsumerConnect;
    this.consumers.push(consumer);
    return consumer;
  }
}

function sdk(client: FakeKafkaClient): KafkaSdkModule {
  return {
    Kafka: class implements KafkaSdkClient {
      constructor(options: KafkaSdkClientOptions) {
        client.optionsSeen.push(options);
      }

      producer(): KafkaSdkProducer {
        return client.producer();
      }

      consumer(options: { readonly groupId: string }): KafkaSdkConsumer {
        return client.consumer(options);
      }
    },
  };
}

async function deliver(consumer: FakeConsumer, message: KafkaEachMessagePayload): Promise<void> {
  const eachMessage = consumer.runOptions?.eachMessage;
  if (eachMessage === undefined) {
    throw new Error("consumer is not running");
  }
  await eachMessage(message);
}

function messageAt(offset: string, value: Uint8Array | null = payload): KafkaEachMessagePayload {
  return { topic: "orders.requests", partition: 2, message: { offset, value } };
}

describe("Kafka transport", () => {
  test("loads the SDK only when the connection opens", async () => {
    const client = new FakeKafkaClient();
    let loads = 0;
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => {
        loads += 1;
        return sdk(client);
      },
    );

    expect(loads).toBe(0);
    await transport.connect();
    expect(loads).toBe(1);
    expect(client.producerInstance.connects).toBe(1);
    await transport.connect();
    expect(loads).toBe(1);
    expect(client.producerInstance.connects).toBe(1);
    await transport.close();
  });

  test("passes brokers, client identity, and the connect timeout to Kafka", async () => {
    const client = new FakeKafkaClient();
    const transport = new KafkaTransport(
      {
        brokers: ["first:9092", "second:9092"],
        clientId: "orders",
        connectTimeoutMs: 250,
        name: "orders-kafka",
      },
      async () => sdk(client),
    );

    await transport.connect();
    expect(transport.name).toBe("orders-kafka");
    expect(client.optionsSeen).toEqual([
      {
        clientId: "orders",
        brokers: ["first:9092", "second:9092"],
        connectionTimeout: 250,
      },
    ]);
    await transport.close();
  });

  test("publishes the envelope to the destination with acks -1", async () => {
    const client = new FakeKafkaClient();
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => sdk(client),
    );

    await transport.connect();
    await transport.publish("orders.requests", payload, "ignored-reply-topic");

    expect(client.producerInstance.sent).toEqual([
      {
        topic: "orders.requests",
        messages: [{ value: payload }],
        acks: -1,
      },
    ]);
    await transport.close();
  });

  test("runs one manual-commit consumer per subscription", async () => {
    const client = new FakeKafkaClient();
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders", fromBeginning: true },
      async () => sdk(client),
    );
    const seen: TransportMessage[] = [];

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, (message) => {
      seen.push(message);
      return "ack";
    });

    const consumer = client.consumers[0];
    expect(consumer).toBeDefined();
    expect(consumer?.groupId.startsWith("orders-")).toBe(true);
    expect(consumer?.subscriptions).toEqual([{ topic: "orders.requests", fromBeginning: true }]);
    expect(consumer?.runOptions?.autoCommit).toBe(false);

    if (consumer === undefined) {
      throw new Error("consumer was not created");
    }
    await deliver(consumer, messageAt("41"));

    expect(seen).toEqual([{ payload }]);
    expect(consumer.commits).toEqual([{ topic: "orders.requests", partition: 2, offset: "42" }]);
    await transport.close();
  });

  test("uses a subscription consumer group and rejects one Kafka cannot accept", async () => {
    const client = new FakeKafkaClient();
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => sdk(client),
    );

    await transport.connect();
    await transport.subscribe(
      { destination: "orders.requests", consumerGroup: "orders.workers" },
      () => "ack",
    );
    expect(client.consumers[0]?.groupId).toBe("orders.workers");

    const failure = await transport
      .subscribe({ destination: "orders.events", consumerGroup: "orders/workers" }, () => "ack")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
    await transport.close();
  });

  test("commits a tombstone without invoking the handler", async () => {
    const client = new FakeKafkaClient();
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => sdk(client),
    );
    let calls = 0;

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => {
      calls += 1;
      return "ack";
    });
    const consumer = client.consumers[0];
    if (consumer === undefined) {
      throw new Error("consumer was not created");
    }
    await deliver(consumer, messageAt("7", null));

    expect(calls).toBe(0);
    expect(consumer.commits).toEqual([{ topic: "orders.requests", partition: 2, offset: "8" }]);
    await transport.close();
  });

  test("stops the lane without committing when the handler returns nack", async () => {
    const client = new FakeKafkaClient();
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => sdk(client),
    );
    let mode: "ack" | "nack" = "nack";
    let calls = 0;

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => {
      calls += 1;
      return mode;
    });
    const consumer = client.consumers[0];
    if (consumer === undefined) {
      throw new Error("consumer was not created");
    }

    await deliver(consumer, messageAt("10"));
    expect(consumer.commits).toEqual([]);
    expect(consumer.pauses).toEqual([{ topic: "orders.requests", partitions: [2] }]);

    mode = "ack";
    await deliver(consumer, messageAt("11"));
    expect(consumer.commits).toEqual([]);
    expect(consumer.pauses).toHaveLength(1);
    expect(calls).toBe(1);
    await transport.close();
  });

  test("stops the lane without committing when the handler throws", async () => {
    const client = new FakeKafkaClient();
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => sdk(client),
    );

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => {
      throw new Error("handler failed with a payload");
    });
    const consumer = client.consumers[0];
    if (consumer === undefined) {
      throw new Error("consumer was not created");
    }

    await deliver(consumer, messageAt("20"));
    expect(consumer.commits).toEqual([]);
    expect(consumer.pauses).toEqual([{ topic: "orders.requests", partitions: [2] }]);
    await transport.close();
  });

  test("pauses without committing when the commit itself fails", async () => {
    const client = new FakeKafkaClient();
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => sdk(client),
    );

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => "ack");
    const consumer = client.consumers[0];
    if (consumer === undefined) {
      throw new Error("consumer was not created");
    }
    consumer.failCommit = true;
    await deliver(consumer, messageAt("20"));

    expect(consumer.commits).toEqual([]);
    expect(consumer.pauses).toEqual([{ topic: "orders.requests", partitions: [2] }]);
    await transport.close();
  });

  test("pauses when an offset is not a committed Kafka offset", async () => {
    const client = new FakeKafkaClient();
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => sdk(client),
    );

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => "ack");
    const consumer = client.consumers[0];
    if (consumer === undefined) {
      throw new Error("consumer was not created");
    }
    await deliver(consumer, messageAt("not-an-offset"));

    expect(consumer.commits).toEqual([]);
    expect(consumer.pauses).toEqual([{ topic: "orders.requests", partitions: [2] }]);
    await transport.close();
  });

  test("closes consumers before the producer and is idempotent", async () => {
    const client = new FakeKafkaClient();
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => sdk(client),
    );

    await transport.connect();
    const handle = await transport.subscribe({ destination: "orders.requests" }, () => "ack");
    await handle.close();
    await handle.close();
    expect(client.consumers[0]?.disconnects).toBe(1);

    await transport.subscribe({ destination: "orders.events" }, () => "ack");
    await transport.close();
    await transport.close();

    expect(client.consumers[1]?.disconnects).toBe(1);
    expect(client.producerInstance.disconnects).toBe(1);
    expect(client.events).toEqual([
      "consumer-disconnect",
      "consumer-disconnect",
      "producer-disconnect",
    ]);
  });

  test("swallows a failing consumer run loop", async () => {
    const client = new FakeKafkaClient();
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => sdk(client),
    );
    client.failNextRun = true;

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => "ack");
    await Bun.sleep(0);
    expect(client.consumers[0]?.failRun).toBe(true);
    await transport.close();
  });

  test("sanitizes a producer connect failure and disconnects the producer", async () => {
    const client = new FakeKafkaClient();
    client.producerInstance.failConnect = true;
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => sdk(client),
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({ transport: "kafka", operation: "connect" });
    expect((failure as AponiaError).message).not.toContain("broker:9092");
    expect(client.producerInstance.disconnects).toBe(1);
  });

  test("sanitizes a consumer failure and closes the consumer", async () => {
    const client = new FakeKafkaClient();
    client.failNextConsumerConnect = true;
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => sdk(client),
    );

    await transport.connect();
    const failure = await transport
      .subscribe({ destination: "orders.requests" }, () => "ack")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_DELIVERY_FAILED");
    expect((failure as AponiaError).details).toEqual({
      transport: "kafka",
      operation: "subscribe",
    });
    expect(client.consumers[0]?.disconnects).toBe(1);
    await transport.close();
  });

  test("does not throw when pausing or disconnecting fails", async () => {
    const client = new FakeKafkaClient();
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => sdk(client),
    );

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => "nack");
    const consumer = client.consumers[0];
    if (consumer === undefined) {
      throw new Error("consumer was not created");
    }
    consumer.failPause = true;
    consumer.failDisconnect = true;
    client.producerInstance.failDisconnect = true;

    await deliver(consumer, messageAt("30"));
    expect(consumer.commits).toEqual([]);
    await transport.close();
    expect(consumer.disconnects).toBe(1);
    expect(client.producerInstance.disconnects).toBe(1);
  });

  test("pauses a tombstone that carries an unreadable offset", async () => {
    const client = new FakeKafkaClient();
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => sdk(client),
    );

    await transport.connect();
    await transport.subscribe({ destination: "orders.requests" }, () => "ack");
    const consumer = client.consumers[0];
    if (consumer === undefined) {
      throw new Error("consumer was not created");
    }
    await deliver(consumer, messageAt("unreadable", null));

    expect(consumer.commits).toEqual([]);
    expect(consumer.pauses).toEqual([{ topic: "orders.requests", partitions: [2] }]);
    await transport.close();
  });

  test("reports the missing package without exposing the loader failure", async () => {
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => {
        throw new Error("cannot resolve kafkajs from /secret/path");
      },
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({ transport: "kafka", package: "kafkajs" });
    expect((failure as AponiaError).message).not.toContain("/secret/path");
  });

  test("rejects an SDK that does not expose Kafka", async () => {
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => ({ Kafka: 42 }) as unknown as KafkaSdkModule,
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({ transport: "kafka", package: "kafkajs" });
  });

  test("rejects a Kafka client without a usable producer factory", async () => {
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () =>
        ({
          Kafka: class {},
        }) as unknown as KafkaSdkModule,
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({ transport: "kafka", package: "kafkajs" });
  });

  test("rejects a producer without a usable connect method", async () => {
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () =>
        ({
          Kafka: class {
            producer(): unknown {
              return {};
            }

            consumer(): unknown {
              return {};
            }
          },
        }) as unknown as KafkaSdkModule,
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({ transport: "kafka", package: "kafkajs" });
  });

  test("rejects invalid options before a connection opens", () => {
    const invalid = [
      {},
      { brokers: [], clientId: "orders" },
      { brokers: ["broker"], clientId: "orders" },
      { brokers: ["br ker:9092"], clientId: "orders" },
      { brokers: ["br$ker:9092"], clientId: "orders" },
      { brokers: ["broker:abc"], clientId: "orders" },
      { brokers: ["broker:0"], clientId: "orders" },
      { brokers: ["broker:70000"], clientId: "orders" },
      { brokers: ["broker:9092"] },
      { brokers: ["broker:9092"], clientId: "orders", groupId: "bad group" },
      { brokers: ["broker:9092"], clientId: "orders", groupId: "bad/group" },
      {
        brokers: ["broker:9092"],
        clientId: "orders",
        groupId: "a".repeat(513),
      },
      { brokers: ["broker:9092"], clientId: "orders", fromBeginning: "yes" },
      { brokers: ["broker:9092"], clientId: "orders", connectTimeoutMs: 0 },
      { brokers: ["broker:9092"], clientId: "orders", name: "a b" },
    ];

    for (const options of invalid) {
      const failure = (() => {
        try {
          new KafkaTransport(options as unknown as KafkaTransportOptions);
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
    const client = new FakeKafkaClient();
    const transport = new KafkaTransport(
      { brokers: ["broker:9092"], clientId: "orders" },
      async () => sdk(client),
    );

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
    expect(kafkaTransport({ brokers: ["broker:9092"], clientId: "orders" }).name).toBe("kafka");
  });
});
