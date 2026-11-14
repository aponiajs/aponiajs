import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import {
  AzureServiceBusTransport,
  azureServiceBusTransport,
} from "../src/brokers/azure-service-bus/azure-service-bus-transport.ts";
import type {
  AzureSdkClient,
  AzureSdkMessageHandlers,
  AzureSdkModule,
  AzureSdkOutboundMessage,
  AzureSdkReceivedMessage,
  AzureSdkReceiver,
  AzureSdkReceiverOptions,
  AzureSdkReceiverSubscription,
  AzureSdkSender,
  AzureSdkSubscribeOptions,
  AzureServiceBusTransportOptions,
} from "../src/brokers/azure-service-bus/azure-service-bus-transport.types.ts";
import type { TransportMessage } from "../src/transport/transport.types.ts";

const connectionString =
  "Endpoint=sb://aponia.servicebus.windows.net/;SharedAccessKeyName=listen;SharedAccessKey=secret-key";
const request = new Uint8Array([1, 2, 3]);
const rejection = new Uint8Array([2, 2, 2]);
const crashing = new Uint8Array([3, 3, 3]);
const queueName = "orders";
const replyQueue = "orders-replies";

class FakeSender implements AzureSdkSender {
  readonly queue: string;
  readonly sent: AzureSdkOutboundMessage[] = [];
  closeCalls = 0;
  failure: Error | undefined;

  constructor(queue: string) {
    this.queue = queue;
  }

  async sendMessages(message: AzureSdkOutboundMessage): Promise<void> {
    if (this.failure !== undefined) {
      throw this.failure;
    }
    this.sent.push(message);
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

class FakeReceiver implements AzureSdkReceiver {
  readonly queue: string;
  readonly options: AzureSdkReceiverOptions;
  handlers: AzureSdkMessageHandlers | undefined;
  subscribeOptions: AzureSdkSubscribeOptions | undefined;
  subscriptionCloseCalls = 0;
  closeCalls = 0;

  constructor(queue: string, options: AzureSdkReceiverOptions) {
    this.queue = queue;
    this.options = options;
  }

  subscribe(
    handlers: AzureSdkMessageHandlers,
    options: AzureSdkSubscribeOptions,
  ): AzureSdkReceiverSubscription {
    this.handlers = handlers;
    this.subscribeOptions = options;
    return {
      close: async (): Promise<void> => {
        this.subscriptionCloseCalls += 1;
      },
    };
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }

  deliver(message: AzureSdkReceivedMessage): Promise<void> | undefined {
    return this.handlers?.processMessage(message);
  }

  fail(error: unknown): Promise<void> | undefined {
    return this.handlers?.processError({ error });
  }
}

class FakeServiceBusClient implements AzureSdkClient {
  readonly connectionString: string;
  readonly senders: FakeSender[] = [];
  readonly receivers: FakeReceiver[] = [];
  closeCalls = 0;
  brokenSender = false;
  brokenReceiver = false;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  createSender(queue: string): AzureSdkSender {
    const sender = new FakeSender(queue);
    this.senders.push(sender);
    return this.brokenSender ? ({} as AzureSdkSender) : sender;
  }

  createReceiver(queue: string, options: AzureSdkReceiverOptions): AzureSdkReceiver {
    const receiver = new FakeReceiver(queue, options);
    this.receivers.push(receiver);
    return this.brokenReceiver ? ({} as AzureSdkReceiver) : receiver;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

function createSdk(): {
  readonly module: AzureSdkModule;
  readonly clients: FakeServiceBusClient[];
} {
  const clients: FakeServiceBusClient[] = [];
  class Client extends FakeServiceBusClient {
    constructor(value: string) {
      super(value);
      clients.push(this);
    }
  }
  return { module: { ServiceBusClient: Client }, clients };
}

function received(
  body: Uint8Array,
  behaviour: { readonly completeThrows?: boolean; readonly abandonThrows?: boolean } = {},
): {
  readonly message: AzureSdkReceivedMessage;
  readonly completed: () => number;
  readonly abandoned: () => number;
} {
  const counters = { completed: 0, abandoned: 0 };
  const message: AzureSdkReceivedMessage = {
    body,
    complete: async (): Promise<void> => {
      counters.completed += 1;
      if (behaviour.completeThrows === true) {
        throw new Error("complete failed");
      }
    },
    abandon: async (): Promise<void> => {
      counters.abandoned += 1;
      if (behaviour.abandonThrows === true) {
        throw new Error("abandon failed");
      }
    },
  };
  return {
    message,
    completed: () => counters.completed,
    abandoned: () => counters.abandoned,
  };
}

function connect(
  options: AzureServiceBusTransportOptions,
  sdk: AzureSdkModule,
): Promise<AzureServiceBusTransport> {
  return (async (): Promise<AzureServiceBusTransport> => {
    const transport = new AzureServiceBusTransport(options, async () => sdk);
    await transport.connect();
    return transport;
  })();
}

describe("Azure Service Bus transport", () => {
  test("loads the SDK only when the connection opens", async () => {
    const { module } = createSdk();
    let loads = 0;
    const transport = new AzureServiceBusTransport({ connectionString }, async () => {
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

  test("constructs the client with the connection string and resolved name", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ connectionString, name: "orders-bus" }, module);

    expect(transport.name).toBe("orders-bus");
    expect(clients[0]?.connectionString).toBe(connectionString);
    await transport.close();
  });

  test("caches one sender per queue and publishes the envelope body", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ connectionString }, module);

    await transport.publish(queueName, request, replyQueue);
    await transport.publish(queueName, rejection);
    await transport.publish(replyQueue, crashing);

    const client = clients[0];
    expect(client?.senders).toHaveLength(2);
    expect(client?.senders[0]?.sent).toEqual([{ body: request }, { body: rejection }]);
    expect(client?.senders[1]?.sent).toEqual([{ body: crashing }]);
    await transport.close();
  });

  test("receives with peek-lock and the configured concurrency and lock renewal", async () => {
    const { module, clients } = createSdk();
    const transport = await connect(
      {
        connectionString,
        maxConcurrentCalls: 4,
        maxAutoLockRenewalDurationMs: 120_000,
      },
      module,
    );

    await transport.subscribe({ destination: queueName }, () => "ack");

    const receiver = clients[0]?.receivers[0];
    expect(receiver?.queue).toBe(queueName);
    expect(receiver?.options).toEqual({
      receiveMode: "peekLock",
      maxAutoLockRenewalDurationInMs: 120_000,
    });
    expect(receiver?.subscribeOptions).toEqual({
      autoCompleteMessages: false,
      maxConcurrentCalls: 4,
    });
    await transport.close();
  });

  test("defaults the concurrency to 16 and the lock renewal to 5 minutes", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ connectionString }, module);

    await transport.subscribe({ destination: queueName }, () => "ack");

    expect(clients[0]?.receivers[0]?.options).toEqual({
      receiveMode: "peekLock",
      maxAutoLockRenewalDurationInMs: 300_000,
    });
    expect(clients[0]?.receivers[0]?.subscribeOptions?.maxConcurrentCalls).toBe(16);
    await transport.close();
  });

  test("settles each delivered message from the handler decision", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ connectionString }, module);
    const seen: TransportMessage[] = [];
    await transport.subscribe({ destination: queueName }, async (message) => {
      seen.push(message);
      if (message.payload[0] === 2) {
        return "nack";
      }
      if (message.payload[0] === 3) {
        throw new Error("handler failed");
      }
      return "ack";
    });
    const receiver = clients[0]?.receivers[0];

    const accepted = received(request);
    await receiver?.deliver(accepted.message);
    expect(accepted.completed()).toBe(1);
    expect(accepted.abandoned()).toBe(0);

    const rejected = received(rejection);
    await receiver?.deliver(rejected.message);
    expect(rejected.completed()).toBe(0);
    expect(rejected.abandoned()).toBe(1);

    const crashed = received(crashing);
    await receiver?.deliver(crashed.message);
    expect(crashed.abandoned()).toBe(1);

    expect(seen).toEqual([{ payload: request }, { payload: rejection }, { payload: crashing }]);
    await transport.close();
  });

  test("swallows settlement and receiver errors instead of throwing into the SDK", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ connectionString }, module);
    await transport.subscribe({ destination: queueName }, (message) =>
      message.payload[0] === 1 ? "ack" : "nack",
    );
    const receiver = clients[0]?.receivers[0];

    const completeFailure = received(request, { completeThrows: true });
    await receiver?.deliver(completeFailure.message);
    const abandonFailure = received(rejection, { abandonThrows: true });
    await receiver?.deliver(abandonFailure.message);
    await receiver?.fail(new Error("transient"));

    expect(completeFailure.completed()).toBe(1);
    expect(abandonFailure.abandoned()).toBe(1);
    await transport.close();
  });

  test("settles a message whose body is malformed without calling the handler", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ connectionString }, module);
    let calls = 0;
    await transport.subscribe({ destination: queueName }, () => {
      calls += 1;
      return "ack";
    });
    const receiver = clients[0]?.receivers[0];
    const malformed = received(undefined as unknown as Uint8Array);

    await receiver?.deliver(malformed.message);

    expect(calls).toBe(0);
    expect(malformed.abandoned()).toBe(1);
    await transport.close();
  });

  test("closes the subscription, receiver, senders, and client once", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ connectionString }, module);
    const handle = await transport.subscribe({ destination: queueName }, () => "ack");
    await transport.publish(queueName, request);
    const client = clients[0];

    await handle.close();
    await handle.close();
    expect(client?.receivers[0]?.subscriptionCloseCalls).toBe(1);
    expect(client?.receivers[0]?.closeCalls).toBe(1);

    await transport.close();
    await transport.close();
    expect(client?.senders[0]?.closeCalls).toBe(1);
    expect(client?.closeCalls).toBe(1);
  });

  test("reports the missing package without exposing the loader failure", async () => {
    const transport = new AzureServiceBusTransport({ connectionString }, async () => {
      throw new Error("cannot resolve @azure/service-bus from /secret/path");
    });

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({
      transport: "azure-service-bus",
      package: "@azure/service-bus",
    });
    expect((failure as AponiaError).message).not.toContain("/secret/path");
  });

  test("sanitizes a constructor failure that names the connection string", async () => {
    const transport = new AzureServiceBusTransport(
      { connectionString },
      async () =>
        ({
          ServiceBusClient: class {
            constructor(value: string) {
              throw new Error(`cannot connect with ${value}`);
            }
          },
        }) as unknown as AzureSdkModule,
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).message).not.toContain("secret-key");
    expect(JSON.stringify((failure as AponiaError).details)).not.toContain("secret-key");
  });

  test("rejects an SDK that does not expose the client surface", async () => {
    const missingClient = new AzureServiceBusTransport(
      { connectionString },
      async () => ({}) as AzureSdkModule,
    );
    const failure = await missingClient.connect().catch((error: unknown) => error);
    expect((failure as AponiaError).details).toEqual({
      transport: "azure-service-bus",
      package: "@azure/service-bus",
    });

    const incomplete = new AzureServiceBusTransport(
      { connectionString },
      async () =>
        ({
          ServiceBusClient: class {
            async close(): Promise<void> {
              return undefined;
            }
          },
        }) as unknown as AzureSdkModule,
    );
    const incompleteFailure = await incomplete.connect().catch((error: unknown) => error);
    expect((incompleteFailure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
  });

  test("rejects a sender or receiver the SDK returns without its surface", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ connectionString }, module);
    if (clients[0] !== undefined) {
      clients[0].brokenSender = true;
    }
    const senderFailure = await transport
      .publish(queueName, request)
      .catch((error: unknown) => error);
    expect((senderFailure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");

    if (clients[0] !== undefined) {
      clients[0].brokenReceiver = true;
    }
    const receiverFailure = await transport
      .subscribe({ destination: queueName }, () => "ack")
      .catch((error: unknown) => error);
    expect((receiverFailure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    await transport.close();
  });

  test("sanitizes a publish failure the SDK reports", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ connectionString }, module);
    await transport.publish(queueName, request);
    if (clients[0]?.senders[0] !== undefined) {
      clients[0].senders[0].failure = new Error(`denied with ${connectionString}`);
    }

    const failure = await transport.publish(queueName, request).catch((error: unknown) => error);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_DELIVERY_FAILED");
    expect((failure as AponiaError).details).toEqual({
      transport: "azure-service-bus",
      operation: "publish",
    });
    expect((failure as AponiaError).message).not.toContain("secret-key");
    await transport.close();
  });

  test("rejects invalid options without echoing the connection string", () => {
    for (const options of [
      {},
      { connectionString: "" },
      { connectionString: "   " },
      { connectionString, maxConcurrentCalls: 0 },
      { connectionString, maxAutoLockRenewalDurationMs: 0 },
      { connectionString, connectTimeoutMs: 0 },
      { connectionString, name: "orders bus" },
    ]) {
      const failure = (() => {
        try {
          new AzureServiceBusTransport(options as AzureServiceBusTransportOptions);
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      expect(failure).toBeInstanceOf(AponiaError);
      expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
      expect((failure as AponiaError).message).not.toContain("secret-key");
    }
  });

  test("rejects an invalid destination before the SDK sees it", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ connectionString }, module);

    const failure = await transport.publish("bad queue", request).catch((error: unknown) => error);
    expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
    expect(clients[0]?.senders).toHaveLength(0);
    await transport.close();
  });

  test("refuses operations before connect and after close", async () => {
    const { module } = createSdk();
    const transport = new AzureServiceBusTransport({ connectionString }, async () => module);

    const before = await transport.publish(queueName, request).catch((error: unknown) => error);
    expect((before as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");

    await transport.connect();
    await transport.close();
    const after = await transport.publish(queueName, request).catch((error: unknown) => error);
    expect((after as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    const reconnect = await transport.connect().catch((error: unknown) => error);
    expect(reconnect).toBeInstanceOf(AponiaError);
  });

  test("builds the public factory with the stable name", () => {
    expect(azureServiceBusTransport({ connectionString }).name).toBe("azure-service-bus");
  });
});
