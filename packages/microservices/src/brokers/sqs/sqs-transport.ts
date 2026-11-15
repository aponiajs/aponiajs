import { AponiaError } from "@aponiajs/common";
import {
  brokerIdentifierIssue,
  brokerOptionsIssues,
  positiveIntegerIssue,
} from "../shared/broker-config.ts";
import { brokerSdkShapeFailure, loadBrokerSdk, requireSdkFunction } from "../shared/broker-sdk.ts";
import { BrokerTransport } from "../shared/broker-transport.ts";
import {
  isTransportString,
  invalidMicroserviceOptions,
} from "../../transport/transport-validation.ts";
import { transportFailure, withTimeout } from "../../transport/transport-lifecycle.ts";
import type {
  TransportDecision,
  TransportHandler,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "../../transport/transport.types.ts";
import type {
  SqsDeliveredMessage,
  SqsReceiveMessageOutput,
  SqsSdkClient,
  SqsSdkLoader,
  SqsSdkModule,
  SqsTransportOptions,
} from "./sqs-transport.types.ts";

const transportName = "aws-sqs";
const packageName = "@aws-sdk/client-sqs";
const defaultWaitTimeSeconds = 20;
const defaultVisibilityTimeoutSeconds = 30;
const defaultMaxMessages = 10;
const defaultConnectTimeoutMs = 10_000;
const maximumSqsBodyBytes = 262_144;
const maximumEndpointLength = 2_048;
const receiveFailureBackoffMs = 1_000;

interface ResolvedSqsOptions {
  readonly region: string;
  readonly endpoint: string | undefined;
  readonly waitTimeSeconds: number;
  readonly visibilityTimeoutSeconds: number;
  readonly maxMessages: number;
  readonly connectTimeoutMs: number;
  readonly name: string;
}

/**
 * Creates an AWS SQS transport.
 *
 * Destinations are queue URLs and the framework never creates a queue. A
 * message body is base64 so arbitrary envelope bytes survive a text-only
 * protocol. Each client needs its own reply queue: the server publishes a
 * reply to the URL the envelope names, it does not address a caller identity.
 *
 * @param options - Region, optional endpoint, polling and visibility bounds, timeout, and name.
 * @returns A transport whose `connect` must succeed before use.
 * @throws `AponiaError` with `INVALID_MICROSERVICE_OPTIONS` when an option is invalid.
 */
export function sqsTransport(options: SqsTransportOptions): SqsTransport {
  return new SqsTransport(options);
}

/**
 * The AWS SQS adapter.
 *
 * @internal
 */
export class SqsTransport extends BrokerTransport {
  readonly #options: ResolvedSqsOptions;
  readonly #loader: SqsSdkLoader;
  readonly #loops = new Map<Promise<void>, AbortController>();
  #connection: SqsConnection | undefined;

  constructor(options: SqsTransportOptions, loader?: SqsSdkLoader) {
    const resolved = resolveOptions(options);
    super(resolved.name);
    this.#options = resolved;
    this.#loader = loader ?? loadSqsSdk;
  }

  protected async open(): Promise<void> {
    const created = await withTimeout(this.#createClient(), this.#options.connectTimeoutMs, () =>
      transportFailure(transportName, "connect"),
    );
    this.#connection = { ...created, abort: new AbortController() };
  }

  protected async publishMessage(
    destination: string,
    payload: Uint8Array,
    _replyTo: string | undefined,
  ): Promise<void> {
    const connection = this.#requireConnection();
    const body = Buffer.from(payload).toString("base64");
    if (Buffer.byteLength(body, "utf8") > maximumSqsBodyBytes) {
      throw new AponiaError(
        "MICROSERVICE_DELIVERY_FAILED",
        `The microservice transport "${transportName}" cannot publish an envelope larger than 256 KiB.`,
        { transport: transportName, operation: "publish", maximumBodyBytes: maximumSqsBodyBytes },
      );
    }
    await connection.client.send(
      new connection.module.SendMessageCommand({ QueueUrl: destination, MessageBody: body }),
      { abortSignal: connection.abort.signal },
    );
  }

  protected async openSubscription(
    subscription: TransportSubscription,
    handler: TransportHandler,
  ): Promise<TransportSubscriptionHandle> {
    const connection = this.#requireConnection();
    const controller = new AbortController();
    const loop = this.#runLoop(
      connection.client,
      connection.module,
      subscription.destination,
      handler,
      controller.signal,
    );
    this.#loops.set(loop, controller);
    let closed = false;
    return Object.freeze({
      close: async (): Promise<void> => {
        if (closed) {
          return;
        }
        closed = true;
        controller.abort();
        await loop;
        this.#loops.delete(loop);
      },
    });
  }

  protected async release(): Promise<void> {
    const connection = this.#connection;
    this.#connection = undefined;
    connection?.abort.abort();
    for (const controller of this.#loops.values()) {
      controller.abort();
    }
    await Promise.all(this.#loops.keys());
    this.#loops.clear();
    try {
      connection?.client.destroy?.();
    } catch {
      // A client that refuses to destroy has already released its sockets.
    }
  }

  async #createClient(): Promise<{ module: SqsSdkModule; client: SqsSdkClient }> {
    const module = await loadBrokerSdk(transportName, packageName, this.#loader);
    if (typeof module !== "object" || module === null) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    requireSdkFunction(module.SQSClient, transportName, packageName);
    requireSdkFunction(module.SendMessageCommand, transportName, packageName);
    requireSdkFunction(module.ReceiveMessageCommand, transportName, packageName);
    requireSdkFunction(module.DeleteMessageCommand, transportName, packageName);
    requireSdkFunction(module.ChangeMessageVisibilityCommand, transportName, packageName);
    const client = new module.SQSClient({
      region: this.#options.region,
      ...(this.#options.endpoint === undefined ? {} : { endpoint: this.#options.endpoint }),
    });
    if (typeof client !== "object" || client === null || typeof client.send !== "function") {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    return { module, client };
  }

  async #runLoop(
    client: SqsSdkClient,
    module: SqsSdkModule,
    queueUrl: string,
    handler: TransportHandler,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      let messages: readonly SqsDeliveredMessage[];
      try {
        const response = await client.send(
          new module.ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: this.#options.maxMessages,
            WaitTimeSeconds: this.#options.waitTimeSeconds,
            VisibilityTimeout: this.#options.visibilityTimeoutSeconds,
          }),
          { abortSignal: signal },
        );
        messages = readMessages(response);
      } catch {
        if (signal.aborted) {
          return;
        }
        await waitForAbort(signal, receiveFailureBackoffMs);
        continue;
      }
      for (const message of messages) {
        if (signal.aborted) {
          return;
        }
        await this.#deliver(client, module, queueUrl, message, handler, signal);
      }
    }
  }

  async #deliver(
    client: SqsSdkClient,
    module: SqsSdkModule,
    queueUrl: string,
    message: SqsDeliveredMessage,
    handler: TransportHandler,
    signal: AbortSignal,
  ): Promise<void> {
    const receiptHandle = message.ReceiptHandle;
    if (typeof receiptHandle !== "string" || receiptHandle === "") {
      return;
    }
    const payload = decodeBody(message.Body);
    let decision: TransportDecision = "nack";
    if (payload !== undefined) {
      try {
        decision = await handler({ payload });
      } catch {
        decision = "nack";
      }
    }
    try {
      if (payload === undefined || decision === "ack") {
        await client.send(
          new module.DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }),
          { abortSignal: signal },
        );
        return;
      }
      await client.send(
        new module.ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: receiptHandle,
          VisibilityTimeout: 0,
        }),
        { abortSignal: signal },
      );
    } catch {
      // A message that could not be settled is redelivered after its visibility timeout.
    }
  }

  #requireConnection(): SqsConnection {
    const connection = this.#connection;
    if (connection === undefined) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    return connection;
  }
}

interface SqsConnection {
  readonly module: SqsSdkModule;
  readonly client: SqsSdkClient;
  readonly abort: AbortController;
}

function resolveOptions(options: SqsTransportOptions): ResolvedSqsOptions {
  const issues = [
    brokerIdentifierIssue(options.region, "region"),
    endpointIssue(options.endpoint),
    integerRangeIssue(options.waitTimeSeconds, "waitTimeSeconds", 0, 20),
    integerRangeIssue(options.visibilityTimeoutSeconds, "visibilityTimeoutSeconds", 0, 43_200),
    integerRangeIssue(options.maxMessages, "maxMessages", 1, 10),
    options.connectTimeoutMs === undefined
      ? undefined
      : positiveIntegerIssue(options.connectTimeoutMs, "connectTimeoutMs"),
    options.name === undefined ? undefined : brokerIdentifierIssue(options.name, "name"),
  ];
  const collected = brokerOptionsIssues(issues);
  if (collected.length > 0) {
    throw invalidMicroserviceOptions("AWS SQS transport options", collected);
  }
  return Object.freeze({
    region: options.region,
    endpoint: options.endpoint,
    waitTimeSeconds: options.waitTimeSeconds ?? defaultWaitTimeSeconds,
    visibilityTimeoutSeconds: options.visibilityTimeoutSeconds ?? defaultVisibilityTimeoutSeconds,
    maxMessages: options.maxMessages ?? defaultMaxMessages,
    connectTimeoutMs: options.connectTimeoutMs ?? defaultConnectTimeoutMs,
    name: options.name ?? transportName,
  });
}

function endpointIssue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isTransportString(value, maximumEndpointLength)) {
    return "endpoint must be a non-empty http or https URL of at most 2048 characters";
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "endpoint must be a valid http or https URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "endpoint must be a valid http or https URL";
  }
  return undefined;
}

function integerRangeIssue(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return `${field} must be an integer from ${minimum} to ${maximum}`;
  }
  return undefined;
}

function readMessages(response: unknown): readonly SqsDeliveredMessage[] {
  if (typeof response !== "object" || response === null) {
    return [];
  }
  const messages = (response as SqsReceiveMessageOutput).Messages;
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.filter(
    (message: unknown): message is SqsDeliveredMessage =>
      typeof message === "object" && message !== null,
  );
}

function decodeBody(body: string | undefined): Uint8Array | undefined {
  if (typeof body !== "string" || body === "") {
    return undefined;
  }
  const decoded = Buffer.from(body, "base64");
  return decoded.byteLength === 0 ? undefined : new Uint8Array(decoded);
}

function waitForAbort(signal: AbortSignal, milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal.removeEventListener("abort", done);
      resolve();
    };
    timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
  });
}

async function loadSqsSdk(): Promise<SqsSdkModule> {
  return (await import("@aws-sdk/client-sqs")) as unknown as SqsSdkModule;
}
