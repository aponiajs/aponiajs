import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { PubSubTransport, pubSubTransport } from "../src/brokers/pubsub/pubsub-transport.ts";
import type {
  PubSubDeliveredMessage,
  PubSubSdkClient,
  PubSubSdkClientOptions,
  PubSubSdkModule,
  PubSubSdkSubscription,
  PubSubSdkSubscriptionOptions,
  PubSubSdkTopic,
  PubSubTransportOptions,
} from "../src/brokers/pubsub/pubsub-transport.types.ts";
import type { TransportMessage } from "../src/transport/transport.types.ts";

const request = new Uint8Array([1, 2, 3]);
const rejection = new Uint8Array([2, 2, 2]);
const crashing = new Uint8Array([3, 3, 3]);
const topicName = "projects/aponia/topics/orders";
const subscriptionName = "projects/aponia/subscriptions/orders";

interface PublishedMessage {
  readonly data: Uint8Array;
  readonly attributes: Record<string, string> | undefined;
}

class FakeTopic implements PubSubSdkTopic {
  readonly published: PublishedMessage[] = [];
  failure: Error | undefined;

  publish(data: Uint8Array, attributes?: Record<string, string>): Promise<string> {
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    this.published.push({ data, attributes });
    return Promise.resolve("message-id");
  }
}

class FakeSubscription implements PubSubSdkSubscription {
  readonly name: string;
  ackCalls = 0;
  ackFailures = 0;
  nackCalls = 0;
  nackFailures = 0;
  closeCalls = 0;
  messageListener: ((message: PubSubDeliveredMessage) => void) | undefined;
  errorListener: ((error: Error) => void) | undefined;
  readonly #onClose: () => void;

  constructor(name: string, onClose: () => void) {
    this.name = name;
    this.#onClose = onClose;
  }

  on(event: "message", listener: (message: PubSubDeliveredMessage) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(
    event: "message" | "error",
    listener: ((message: PubSubDeliveredMessage) => void) | ((error: Error) => void),
  ): this {
    if (event === "message") {
      this.messageListener = listener as (message: PubSubDeliveredMessage) => void;
    } else {
      this.errorListener = listener as (error: Error) => void;
    }
    return this;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.#onClose();
  }

  deliver(message: PubSubDeliveredMessage): void {
    this.messageListener?.(message);
  }
}

interface SubscriptionCall {
  readonly name: string;
  readonly options: PubSubSdkSubscriptionOptions | undefined;
}

class FakePubSubClient implements PubSubSdkClient {
  readonly options: PubSubSdkClientOptions | undefined;
  readonly events: string[] = [];
  readonly topics: FakeTopic[] = [];
  readonly subscriptions: FakeSubscription[] = [];
  readonly topicCalls: string[] = [];
  readonly subscriptionCalls: SubscriptionCall[] = [];
  closeCalls = 0;
  brokenSubscription = false;
  topicFailure: Error | undefined;

  constructor(options: PubSubSdkClientOptions | undefined) {
    this.options = options;
  }

  topic(name: string): PubSubSdkTopic {
    this.topicCalls.push(name);
    const topic = new FakeTopic();
    topic.failure = this.topicFailure;
    this.topics.push(topic);
    return topic;
  }

  subscription(name: string, options?: PubSubSdkSubscriptionOptions): PubSubSdkSubscription {
    this.subscriptionCalls.push({ name, options });
    if (this.brokenSubscription) {
      return {} as PubSubSdkSubscription;
    }
    const subscription = new FakeSubscription(name, () => {
      this.events.push(`subscription:${name}:close`);
    });
    this.subscriptions.push(subscription);
    this.events.push(`subscription:${name}:open`);
    return subscription;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.events.push("client:close");
  }
}

function createSdk(): { readonly module: PubSubSdkModule; readonly clients: FakePubSubClient[] } {
  const clients: FakePubSubClient[] = [];
  class Client extends FakePubSubClient {
    constructor(options?: PubSubSdkClientOptions) {
      super(options);
      clients.push(this);
    }
  }
  return { module: { PubSub: Client }, clients };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(0);
  }
  throw new Error("condition was not reached");
}

function connect(options: PubSubTransportOptions, sdk: PubSubSdkModule): Promise<PubSubTransport> {
  return (async (): Promise<PubSubTransport> => {
    const transport = new PubSubTransport(options, async () => sdk);
    await transport.connect();
    return transport;
  })();
}

describe("Google Cloud Pub/Sub transport", () => {
  test("loads the SDK only when the connection opens", async () => {
    const { module } = createSdk();
    let loads = 0;
    const transport = new PubSubTransport({}, async () => {
      loads += 1;
      return module;
    });

    expect(loads).toBe(0);
    await transport.connect();
    expect(loads).toBe(1);
    await transport.connect();
    expect(loads).toBe(1);
    await transport.close();
  });

  test("constructs the client with the configured project", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ projectId: "aponia-prod" }, module);

    expect(clients[0]?.options).toEqual({ projectId: "aponia-prod" });
    await transport.close();
  });

  test("constructs the client without project options when none are set", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({}, module);

    expect(clients[0]?.options).toBeUndefined();
    await transport.close();
  });

  test("subscribes with the configured flow control and reports its name", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ flowControlMaxMessages: 12, name: "orders-pubsub" }, module);
    await transport.subscribe({ destination: subscriptionName }, () => "ack");

    expect(clients[0]?.subscriptionCalls).toEqual([
      { name: subscriptionName, options: { flowControl: { maxMessages: 12 } } },
    ]);
    expect(transport.name).toBe("orders-pubsub");
    await transport.close();
  });

  test("defaults the flow control to 100 messages", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({}, module);
    await transport.subscribe({ destination: subscriptionName }, () => "ack");

    expect(clients[0]?.subscriptionCalls[0]?.options).toEqual({
      flowControl: { maxMessages: 100 },
    });
    await transport.close();
  });

  test("publishes the envelope to a topic", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({}, module);

    await transport.publish(topicName, request);

    expect(clients[0]?.topicCalls).toEqual([topicName]);
    expect(clients[0]?.topics[0]?.published).toEqual([{ data: request, attributes: undefined }]);
    await transport.close();
  });

  test("settles each delivered message from the handler decision", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({}, module);
    const seen: TransportMessage[] = [];
    await transport.subscribe({ destination: subscriptionName }, async (message) => {
      seen.push(message);
      if (message.payload[0] === 2) {
        return "nack";
      }
      if (message.payload[0] === 3) {
        throw new Error("handler failed");
      }
      return "ack";
    });
    const subscription = clients[0]?.subscriptions[0];
    const counters = { ack: 0, nack: 0 };
    const deliver = (data: Uint8Array): void => {
      subscription?.deliver({
        data,
        ack: () => {
          counters.ack += 1;
        },
        nack: () => {
          counters.nack += 1;
        },
      });
    };

    deliver(request);
    await until(() => counters.ack === 1);
    deliver(rejection);
    await until(() => counters.nack === 1);
    deliver(crashing);
    await until(() => counters.nack === 2);

    expect(seen).toEqual([{ payload: request }, { payload: rejection }, { payload: crashing }]);
    expect(subscription?.errorListener).toBeDefined();
    expect(() => subscription?.errorListener?.(new Error("transient"))).not.toThrow();
    await transport.close();
  });

  test("settles a message whose payload is malformed without calling the handler", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({}, module);
    let calls = 0;
    await transport.subscribe({ destination: subscriptionName }, () => {
      calls += 1;
      return "ack";
    });
    const subscription = clients[0]?.subscriptions[0];
    let nacks = 0;
    subscription?.deliver({
      data: undefined as unknown as Uint8Array,
      ack: () => undefined,
      nack: () => {
        nacks += 1;
      },
    });

    await until(() => nacks === 1);
    expect(calls).toBe(0);
    await transport.close();
  });

  test("swallows settlement failures instead of throwing into the SDK", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({}, module);
    await transport.subscribe({ destination: subscriptionName }, () => "ack");
    const subscription = clients[0]?.subscriptions[0];
    let attempts = 0;
    subscription?.deliver({
      data: request,
      ack: () => {
        attempts += 1;
        throw new Error("ack failed");
      },
      nack: () => undefined,
    });

    await until(() => attempts === 1);
    await Bun.sleep(0);
    await transport.close();
  });

  test("closes subscriptions before the client, idempotently", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({}, module);
    const handle = await transport.subscribe({ destination: subscriptionName }, () => "ack");

    await handle.close();
    await handle.close();
    expect(clients[0]?.subscriptions[0]?.closeCalls).toBe(1);

    await transport.close();
    await transport.close();
    expect(clients[0]?.events).toEqual([
      `subscription:${subscriptionName}:open`,
      `subscription:${subscriptionName}:close`,
      "client:close",
    ]);
    expect(clients[0]?.closeCalls).toBe(1);
  });

  test("reports the missing package without exposing the loader failure", async () => {
    const transport = new PubSubTransport({}, async () => {
      throw new Error("cannot resolve @google-cloud/pubsub from /secret/path");
    });

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({
      transport: "gcp-pubsub",
      package: "@google-cloud/pubsub",
    });
    expect((failure as AponiaError).message).not.toContain("/secret/path");
  });

  test("rejects an SDK that does not expose the client surface", async () => {
    const missingClient = new PubSubTransport({}, async () => ({}) as PubSubSdkModule);
    const failure = await missingClient.connect().catch((error: unknown) => error);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({
      transport: "gcp-pubsub",
      package: "@google-cloud/pubsub",
    });

    const incomplete = new PubSubTransport(
      {},
      async () =>
        ({
          PubSub: class {
            async close(): Promise<void> {
              return undefined;
            }
          },
        }) as unknown as PubSubSdkModule,
    );
    const incompleteFailure = await incomplete.connect().catch((error: unknown) => error);
    expect((incompleteFailure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
  });

  test("rejects a subscription the SDK returns without a listener surface", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({}, module);
    if (clients[0] !== undefined) {
      clients[0].brokenSubscription = true;
    }

    const failure = await transport
      .subscribe({ destination: subscriptionName }, () => "ack")
      .catch((error: unknown) => error);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    await transport.close();
  });

  test("sanitizes a publish failure the SDK reports", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({}, module);
    await transport.publish(topicName, request);
    if (clients[0] !== undefined) {
      clients[0].topicFailure = new Error("denied at projects/secret");
    }

    const failure = await transport.publish(topicName, request).catch((error: unknown) => error);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_DELIVERY_FAILED");
    expect((failure as AponiaError).details).toEqual({
      transport: "gcp-pubsub",
      operation: "publish",
    });
    expect((failure as AponiaError).message).not.toContain("projects/secret");
    await transport.close();
  });

  test("rejects invalid options", () => {
    for (const options of [
      { projectId: "aponia prod" },
      { projectId: "" },
      { flowControlMaxMessages: 0 },
      { flowControlMaxMessages: 2.5 },
      { connectTimeoutMs: 0 },
      { name: "a b" },
    ]) {
      const failure = (() => {
        try {
          new PubSubTransport(options as PubSubTransportOptions);
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
    const { module } = createSdk();
    const transport = new PubSubTransport({}, async () => module);

    const before = await transport.publish(topicName, request).catch((error: unknown) => error);
    expect((before as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");

    await transport.connect();
    await transport.close();
    const after = await transport.publish(topicName, request).catch((error: unknown) => error);
    expect((after as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    const reconnect = await transport.connect().catch((error: unknown) => error);
    expect(reconnect).toBeInstanceOf(AponiaError);
  });

  test("builds the public factory with the stable name", () => {
    expect(pubSubTransport().name).toBe("gcp-pubsub");
  });
});
