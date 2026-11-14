import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { SqsTransport, sqsTransport } from "../src/brokers/sqs/sqs-transport.ts";
import type {
  SqsChangeMessageVisibilityInput,
  SqsDeliveredMessage,
  SqsDeleteMessageInput,
  SqsReceiveMessageInput,
  SqsSdkClient,
  SqsSdkClientConfig,
  SqsSdkModule,
  SqsSdkSendOptions,
  SqsSendMessageInput,
  SqsTransportOptions,
} from "../src/brokers/sqs/sqs-transport.types.ts";
import type { TransportMessage } from "../src/transport/transport.types.ts";

const request = new Uint8Array([1, 2, 3]);
const rejection = new Uint8Array([2, 2, 2]);
const crashing = new Uint8Array([3, 3, 3]);
const queueUrl = "https://sqs.eu-west-1.amazonaws.com/000000000000/orders";
const replyUrl = "https://sqs.eu-west-1.amazonaws.com/000000000000/orders-replies";

class FakeSendMessageCommand {
  readonly kind = "send";

  constructor(readonly input: SqsSendMessageInput) {}
}

class FakeReceiveMessageCommand {
  readonly kind = "receive";

  constructor(readonly input: SqsReceiveMessageInput) {}
}

class FakeDeleteMessageCommand {
  readonly kind = "delete";

  constructor(readonly input: SqsDeleteMessageInput) {}
}

class FakeChangeMessageVisibilityCommand {
  readonly kind = "change";

  constructor(readonly input: SqsChangeMessageVisibilityInput) {}
}

interface ReceiveWaiter {
  readonly queueUrl: string;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly abort: () => void;
}

class FakeSqsClient implements SqsSdkClient {
  readonly config: SqsSdkClientConfig;
  readonly sent: { readonly command: unknown; readonly signal: AbortSignal | undefined }[] = [];
  readonly published: SqsSendMessageInput[] = [];
  readonly deleted: SqsDeleteMessageInput[] = [];
  readonly changed: SqsChangeMessageVisibilityInput[] = [];
  readonly received: SqsReceiveMessageInput[] = [];
  destroyCalls = 0;
  sendError: Error | undefined;
  receiveError: Error | undefined;
  settleError: Error | undefined;
  destroyError: Error | undefined;
  readonly receiveResponses: unknown[] = [];
  readonly #inbox = new Map<string, SqsDeliveredMessage[]>();
  readonly #batches: { readonly queue: string; readonly messages: SqsDeliveredMessage[] }[] = [];
  readonly #waiters: ReceiveWaiter[] = [];

  constructor(config: SqsSdkClientConfig) {
    this.config = config;
  }

  get pendingReceives(): number {
    return this.#waiters.length;
  }

  send(command: unknown, options?: SqsSdkSendOptions): Promise<unknown> {
    this.sent.push({ command, signal: options?.abortSignal });
    if (this.sendError !== undefined) {
      return Promise.reject(this.sendError);
    }
    const record = command as { readonly kind: string; readonly input: unknown };
    if (record.kind === "send") {
      const input = record.input as SqsSendMessageInput;
      this.published.push(input);
      return Promise.resolve({ MessageId: "one" });
    }
    if (record.kind === "delete") {
      this.deleted.push(record.input as SqsDeleteMessageInput);
      if (this.settleError !== undefined) {
        return Promise.reject(this.settleError);
      }
      return Promise.resolve({});
    }
    if (record.kind === "change") {
      this.changed.push(record.input as SqsChangeMessageVisibilityInput);
      if (this.settleError !== undefined) {
        return Promise.reject(this.settleError);
      }
      return Promise.resolve({});
    }
    return this.#receive(record.input as SqsReceiveMessageInput, options?.abortSignal);
  }

  destroy(): void {
    this.destroyCalls += 1;
    if (this.destroyError !== undefined) {
      throw this.destroyError;
    }
  }

  deliverBatch(queue: string, messages: readonly SqsDeliveredMessage[]): void {
    const index = this.#waiters.findIndex((waiter) => waiter.queueUrl === queue);
    const waiter = index === -1 ? undefined : this.#waiters.splice(index, 1)[0];
    if (waiter !== undefined) {
      waiter.signal?.removeEventListener("abort", waiter.abort);
      waiter.resolve({ Messages: [...messages] });
      return;
    }
    this.#batches.push({ queue, messages: [...messages] });
  }

  deliver(queue: string, message: SqsDeliveredMessage): void {
    const index = this.#waiters.findIndex((waiter) => waiter.queueUrl === queue);
    const waiter = index === -1 ? undefined : this.#waiters.splice(index, 1)[0];
    if (waiter === undefined) {
      const queued = this.#inbox.get(queue) ?? [];
      queued.push(message);
      this.#inbox.set(queue, queued);
      return;
    }
    waiter.signal?.removeEventListener("abort", waiter.abort);
    waiter.resolve({ Messages: [message] });
  }

  #receive(input: SqsReceiveMessageInput, signal: AbortSignal | undefined): Promise<unknown> {
    this.received.push(input);
    if (this.receiveError !== undefined) {
      return Promise.reject(this.receiveError);
    }
    const response = this.receiveResponses.shift();
    if (response !== undefined) {
      return Promise.resolve(response);
    }
    const batchIndex = this.#batches.findIndex((batch) => batch.queue === input.QueueUrl);
    if (batchIndex !== -1) {
      const batch = this.#batches.splice(batchIndex, 1)[0];
      return Promise.resolve({ Messages: batch?.messages ?? [] });
    }
    const queued = this.#inbox.get(input.QueueUrl)?.shift();
    if (queued !== undefined) {
      return Promise.resolve({ Messages: [queued] });
    }
    return new Promise((resolve, reject) => {
      const waiter: ReceiveWaiter = {
        queueUrl: input.QueueUrl,
        signal,
        resolve,
        reject,
        abort: () => {
          const position = this.#waiters.indexOf(waiter);
          if (position !== -1) {
            this.#waiters.splice(position, 1);
          }
          signal?.removeEventListener("abort", waiter.abort);
          reject(new Error("aborted"));
        },
      };
      signal?.addEventListener("abort", waiter.abort, { once: true });
      this.#waiters.push(waiter);
    });
  }
}

function createSdk(): { readonly module: SqsSdkModule; readonly clients: FakeSqsClient[] } {
  const clients: FakeSqsClient[] = [];
  class Client extends FakeSqsClient {
    constructor(config: SqsSdkClientConfig) {
      super(config);
      clients.push(this);
    }
  }
  return {
    module: {
      SQSClient: Client,
      SendMessageCommand: FakeSendMessageCommand,
      ReceiveMessageCommand: FakeReceiveMessageCommand,
      DeleteMessageCommand: FakeDeleteMessageCommand,
      ChangeMessageVisibilityCommand: FakeChangeMessageVisibilityCommand,
    },
    clients,
  };
}

function encode(payload: Uint8Array): string {
  return Buffer.from(payload).toString("base64");
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

function connect(options: SqsTransportOptions, sdk: SqsSdkModule): Promise<SqsTransport> {
  return (async (): Promise<SqsTransport> => {
    const transport = new SqsTransport(options, async () => sdk);
    await transport.connect();
    return transport;
  })();
}

describe("AWS SQS transport", () => {
  test("loads the SDK only when the connection opens", async () => {
    const { module } = createSdk();
    let loads = 0;
    const transport = new SqsTransport({ region: "us-east-1" }, async () => {
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

  test("constructs the client and polls with the resolved options", async () => {
    const { module, clients } = createSdk();
    const transport = await connect(
      {
        region: "eu-west-1",
        endpoint: "http://localhost:4566",
        waitTimeSeconds: 3,
        visibilityTimeoutSeconds: 45,
        maxMessages: 4,
        connectTimeoutMs: 250,
        name: "orders-sqs",
      },
      module,
    );
    const client = clients[0];
    expect(client?.config).toEqual({ region: "eu-west-1", endpoint: "http://localhost:4566" });
    expect(transport.name).toBe("orders-sqs");

    await transport.subscribe({ destination: queueUrl }, () => "ack");
    await until(() => client !== undefined && client.received.length === 1);
    expect(client?.received[0]).toEqual({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 4,
      WaitTimeSeconds: 3,
      VisibilityTimeout: 45,
    });
    await transport.close();
  });

  test("publishes the envelope as a base64 body and ignores the reply field", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ region: "us-east-1" }, module);

    await transport.publish(queueUrl, request, replyUrl);

    expect(clients[0]?.published).toEqual([{ QueueUrl: queueUrl, MessageBody: encode(request) }]);
    await transport.close();
  });

  test("rejects an encoded body beyond the 256 KiB SQS limit before sending", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ region: "us-east-1" }, module);

    await transport.publish(queueUrl, new Uint8Array(196_608));
    expect(clients[0]?.published).toHaveLength(1);
    expect(Buffer.byteLength(clients[0]?.published[0]?.MessageBody ?? "", "utf8")).toBe(262_144);

    const failure = await transport
      .publish(queueUrl, new Uint8Array(196_609))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_DELIVERY_FAILED");
    expect((failure as AponiaError).details).toEqual({
      transport: "aws-sqs",
      operation: "publish",
      maximumBodyBytes: 262_144,
    });
    expect(clients[0]?.published).toHaveLength(1);
    await transport.close();
  });

  test("settles each delivered message from the handler decision", async () => {
    const { module, clients } = createSdk();
    const transport = new SqsTransport({ region: "us-east-1" }, async () => module);
    await transport.connect();
    const client = clients[0];
    const seen: TransportMessage[] = [];
    await transport.subscribe({ destination: queueUrl }, async (message) => {
      seen.push(message);
      if (message.payload[0] === 2) {
        return "nack";
      }
      if (message.payload[0] === 3) {
        throw new Error("handler failed");
      }
      return "ack";
    });
    await until(() => client !== undefined && client.pendingReceives === 1);
    client?.deliver(queueUrl, { Body: encode(request), ReceiptHandle: "first" });
    await until(() => client !== undefined && client.deleted.length === 1);
    client?.deliver(queueUrl, { Body: encode(rejection), ReceiptHandle: "second" });
    await until(() => client !== undefined && client.changed.length === 1);
    client?.deliver(queueUrl, { Body: encode(crashing), ReceiptHandle: "third" });
    await until(() => client !== undefined && client.changed.length === 2);
    client?.deliver(queueUrl, { ReceiptHandle: "fourth" });
    await until(() => client !== undefined && client.deleted.length === 2);

    expect(seen).toEqual([{ payload: request }, { payload: rejection }, { payload: crashing }]);
    expect(client?.deleted).toEqual([
      { QueueUrl: queueUrl, ReceiptHandle: "first" },
      { QueueUrl: queueUrl, ReceiptHandle: "fourth" },
    ]);
    expect(client?.changed).toEqual([
      { QueueUrl: queueUrl, ReceiptHandle: "second", VisibilityTimeout: 0 },
      { QueueUrl: queueUrl, ReceiptHandle: "third", VisibilityTimeout: 0 },
    ]);
    await transport.close();
  });

  test("closes one subscription idempotently and aborts its receive", async () => {
    const { module, clients } = createSdk();
    const transport = new SqsTransport({ region: "us-east-1" }, async () => module);
    await transport.connect();
    const client = clients[0];
    const handle = await transport.subscribe({ destination: queueUrl }, () => "ack");
    await until(() => client !== undefined && client.pendingReceives === 1);

    await handle.close();
    await handle.close();

    expect(client?.pendingReceives).toBe(0);
    await transport.close();
    expect(client?.destroyCalls).toBe(1);
  });

  test("closes the transport once, aborting an in-flight receive", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ region: "us-east-1" }, module);
    const client = clients[0];
    await transport.subscribe({ destination: queueUrl }, () => "ack");
    await until(() => client !== undefined && client.pendingReceives === 1);

    await transport.close();
    await transport.close();

    expect(client?.pendingReceives).toBe(0);
    expect(client?.destroyCalls).toBe(1);
  });

  test("stops the loop when a receive fails and the transport closes", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ region: "us-east-1" }, module);
    const client = clients[0];
    if (client !== undefined) {
      client.receiveError = new Error("network down at secret://host");
    }
    await transport.subscribe({ destination: queueUrl }, () => "ack");
    await until(() => client !== undefined && client.received.length === 1);

    await transport.close();

    expect(client?.received).toHaveLength(1);
  });

  test("reports the missing package without exposing the loader failure", async () => {
    const transport = new SqsTransport({ region: "us-east-1" }, async () => {
      throw new Error("cannot resolve @aws-sdk/client-sqs from /secret/path");
    });

    const failure = await transport.connect().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AponiaError);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({
      transport: "aws-sqs",
      package: "@aws-sdk/client-sqs",
    });
    expect((failure as AponiaError).message).not.toContain("/secret/path");
  });

  test("rejects an SDK that does not expose the client or the commands", async () => {
    const missingClient = new SqsTransport(
      { region: "us-east-1" },
      async () => ({}) as SqsSdkModule,
    );
    const clientFailure = await missingClient.connect().catch((error: unknown) => error);
    expect((clientFailure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((clientFailure as AponiaError).details).toEqual({
      transport: "aws-sqs",
      package: "@aws-sdk/client-sqs",
    });

    const brokenClient = new SqsTransport(
      { region: "us-east-1" },
      async () =>
        ({
          SQSClient: class {},
          SendMessageCommand: FakeSendMessageCommand,
          ReceiveMessageCommand: FakeReceiveMessageCommand,
          DeleteMessageCommand: FakeDeleteMessageCommand,
          ChangeMessageVisibilityCommand: FakeChangeMessageVisibilityCommand,
        }) as unknown as SqsSdkModule,
    );
    const brokenFailure = await brokenClient.connect().catch((error: unknown) => error);
    expect((brokenFailure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
  });

  test("rejects invalid options without echoing their values", () => {
    for (const options of [
      {},
      { region: "us east 1" },
      { region: "us-east-1", endpoint: "ftp://secret-host" },
      { region: "us-east-1", endpoint: "not a url" },
      { region: "us-east-1", waitTimeSeconds: -1 },
      { region: "us-east-1", waitTimeSeconds: 21 },
      { region: "us-east-1", waitTimeSeconds: 1.5 },
      { region: "us-east-1", visibilityTimeoutSeconds: -1 },
      { region: "us-east-1", visibilityTimeoutSeconds: 43_201 },
      { region: "us-east-1", maxMessages: 0 },
      { region: "us-east-1", maxMessages: 11 },
      { region: "us-east-1", connectTimeoutMs: 0 },
      { region: "us-east-1", name: "aws sqs" },
    ]) {
      const failure = (() => {
        try {
          new SqsTransport(options as SqsTransportOptions);
          return undefined;
        } catch (error) {
          return error;
        }
      })();
      expect(failure).toBeInstanceOf(AponiaError);
      expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
      expect((failure as AponiaError).message).not.toContain("secret-host");
    }
  });

  test("rejects an invalid destination before the SDK sees it", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ region: "us-east-1" }, module);

    const failure = await transport.publish("bad queue", request).catch((error: unknown) => error);
    expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
    expect(clients[0]?.published).toHaveLength(0);
    await transport.close();
  });

  test("sanitizes a publish failure the SDK reports", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ region: "us-east-1" }, module);
    if (clients[0] !== undefined) {
      clients[0].sendError = new Error("denied at https://sqs.example/secret-queue");
    }

    const failure = await transport.publish(queueUrl, request).catch((error: unknown) => error);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_DELIVERY_FAILED");
    expect((failure as AponiaError).details).toEqual({
      transport: "aws-sqs",
      operation: "publish",
    });
    expect((failure as AponiaError).message).not.toContain("secret-queue");
    await transport.close();
  });

  test("refuses operations before connect and after close", async () => {
    const { module } = createSdk();
    const transport = new SqsTransport({ region: "us-east-1" }, async () => module);

    const before = await transport.publish(queueUrl, request).catch((error: unknown) => error);
    expect((before as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");

    await transport.connect();
    await transport.close();
    const after = await transport.publish(queueUrl, request).catch((error: unknown) => error);
    expect((after as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    const reconnect = await transport.connect().catch((error: unknown) => error);
    expect(reconnect).toBeInstanceOf(AponiaError);
  });

  test("fails a connect attempt that outlives its timeout", async () => {
    const transport = new SqsTransport(
      { region: "us-east-1", connectTimeoutMs: 1 },
      () => new Promise<SqsSdkModule>(() => undefined),
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect((failure as AponiaError).code).toBe("MICROSERVICE_TRANSPORT_UNAVAILABLE");
    expect((failure as AponiaError).details).toEqual({
      transport: "aws-sqs",
      operation: "connect",
    });
  });

  test("reads an unexpected receive response as an empty poll", async () => {
    const { module, clients } = createSdk();
    const transport = new SqsTransport({ region: "us-east-1" }, async () => module);
    await transport.connect();
    const client = clients[0];
    let calls = 0;
    client?.receiveResponses.push(
      "unexpected",
      { Messages: "no" },
      { Messages: [null, 42, { Body: encode(request), ReceiptHandle: "odd" }] },
    );
    await transport.subscribe({ destination: queueUrl }, () => {
      calls += 1;
      return "ack";
    });

    await until(() => calls === 1);
    expect(client?.deleted).toEqual([{ QueueUrl: queueUrl, ReceiptHandle: "odd" }]);
    await transport.close();
  });

  test("skips a message without a receipt handle", async () => {
    const { module, clients } = createSdk();
    const transport = new SqsTransport({ region: "us-east-1" }, async () => module);
    await transport.connect();
    const client = clients[0];
    let calls = 0;
    await transport.subscribe({ destination: queueUrl }, () => {
      calls += 1;
      return "ack";
    });
    await until(() => client !== undefined && client.pendingReceives === 1);
    client?.deliver(queueUrl, { Body: encode(request) });

    await until(() => client !== undefined && client.received.length === 2);
    expect(calls).toBe(0);
    expect(client?.deleted).toHaveLength(0);
    await transport.close();
  });

  test("swallows a settlement failure so the loop keeps polling", async () => {
    const { module, clients } = createSdk();
    const transport = new SqsTransport({ region: "us-east-1" }, async () => module);
    await transport.connect();
    const client = clients[0];
    await transport.subscribe({ destination: queueUrl }, () => "ack");
    await until(() => client !== undefined && client.pendingReceives === 1);
    if (client !== undefined) {
      client.settleError = new Error("delete denied");
    }
    client?.deliver(queueUrl, { Body: encode(request), ReceiptHandle: "unsettled" });

    await until(() => client !== undefined && client.received.length === 2);
    expect(client?.deleted).toEqual([{ QueueUrl: queueUrl, ReceiptHandle: "unsettled" }]);
    await transport.close();
  });

  test("stops a batch when its subscription closes while a handler is running", async () => {
    const { module, clients } = createSdk();
    const transport = new SqsTransport({ region: "us-east-1" }, async () => module);
    await transport.connect();
    const client = clients[0];
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = await transport.subscribe(
      { destination: queueUrl },
      async (): Promise<"ack"> => {
        calls += 1;
        await gate;
        return "ack";
      },
    );
    await until(() => client !== undefined && client.pendingReceives === 1);
    client?.deliverBatch(queueUrl, [
      { Body: encode(request), ReceiptHandle: "batched-first" },
      { Body: encode(rejection), ReceiptHandle: "batched-second" },
    ]);
    await until(() => calls === 1);

    const closing = handle.close();
    release?.();
    await closing;

    expect(calls).toBe(1);
    expect(client?.deleted).toEqual([{ QueueUrl: queueUrl, ReceiptHandle: "batched-first" }]);
    await transport.close();
  });

  test("closes even when the client refuses to destroy", async () => {
    const { module, clients } = createSdk();
    const transport = await connect({ region: "us-east-1" }, module);
    if (clients[0] !== undefined) {
      clients[0].destroyError = new Error("destroy failed");
    }

    await transport.close();

    expect(clients[0]?.destroyCalls).toBe(1);
  });

  test("rejects a module that is not an object", async () => {
    const transport = new SqsTransport(
      { region: "us-east-1" },
      async () => null as unknown as SqsSdkModule,
    );

    const failure = await transport.connect().catch((error: unknown) => error);
    expect((failure as AponiaError).details).toEqual({
      transport: "aws-sqs",
      package: "@aws-sdk/client-sqs",
    });
  });

  test("rejects an endpoint that is not a bounded URL", () => {
    const failure = (() => {
      try {
        new SqsTransport({ region: "us-east-1", endpoint: `https://${"a".repeat(2_050)}` });
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect((failure as AponiaError).code).toBe("INVALID_MICROSERVICE_OPTIONS");
  });

  test("opens the installed SQS SDK through the literal loader", async () => {
    const transport = new SqsTransport({ region: "us-east-1" });

    await transport.connect();
    await transport.close();
  });

  test("builds the public factory with the stable name", () => {
    expect(sqsTransport({ region: "us-east-1" }).name).toBe("aws-sqs");
  });
});
