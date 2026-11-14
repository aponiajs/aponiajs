import {
  brokerIdentifierIssue,
  brokerOptionsIssues,
  optionalBrokerStringIssue,
  positiveIntegerIssue,
} from "../shared/broker-config.ts";
import { brokerSdkShapeFailure, loadBrokerSdk } from "../shared/broker-sdk.ts";
import { BrokerTransport } from "../shared/broker-transport.ts";
import { invalidMicroserviceOptions } from "../../transport/transport-validation.ts";
import type {
  TransportHandler,
  TransportMessage,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "../../transport/transport.types.ts";
import type {
  RabbitMqSdkConnection,
  RabbitMqSdkConsumer,
  RabbitMqSdkConsumerStatus,
  RabbitMqSdkLoader,
  RabbitMqSdkModule,
  RabbitMqSdkPublisher,
  RabbitMqTransportOptions,
} from "./rabbitmq-transport.types.ts";

const transportName = "rabbitmq";
const packageName = "rabbitmq-client";
const defaultPrefetch = 64;
const defaultConnectTimeoutMs = 10_000;

interface ResolvedRabbitMqOptions {
  readonly url: string;
  readonly prefetch: number;
  readonly connectTimeoutMs: number;
  readonly name: string;
}

/**
 * Creates a RabbitMQ transport.
 *
 * Destinations are queue names the operator provisions; the framework never
 * declares queues, exchanges, or bindings. A handler's `ack` decision settles
 * the delivery and `nack` returns it to the queue. Replies travel through the
 * same confirmed publisher to the envelope's own reply destination.
 *
 * @param options - The URL, prefetch count, timeout, and name.
 * @returns A transport whose `connect` must succeed before use.
 * @throws `AponiaError` with `INVALID_MICROSERVICE_OPTIONS` when an option is invalid.
 */
export function rabbitmqTransport(options: RabbitMqTransportOptions): RabbitMqTransport {
  return new RabbitMqTransport(options);
}

/**
 * The RabbitMQ adapter.
 *
 * @internal
 */
export class RabbitMqTransport extends BrokerTransport {
  readonly #options: ResolvedRabbitMqOptions;
  readonly #loader: RabbitMqSdkLoader;
  #connection: RabbitMqSdkConnection | undefined;
  #publisher: RabbitMqSdkPublisher | undefined;
  #consumerStatus: RabbitMqSdkConsumerStatus | undefined;

  constructor(options: RabbitMqTransportOptions, loader?: RabbitMqSdkLoader) {
    const resolved = resolveOptions(options);
    super(resolved.name);
    this.#options = resolved;
    this.#loader = loader ?? loadRabbitMqSdk;
  }

  protected async open(): Promise<void> {
    const module = await loadBrokerSdk(transportName, packageName, this.#loader);
    const Connection = module.default ?? module.Connection;
    if (typeof Connection !== "function") {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    const status = module.ConsumerStatus;
    if (!hasConsumerStatusShape(status)) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }

    const created: unknown = new Connection(this.#options.url, {
      connectionTimeout: this.#options.connectTimeoutMs,
    });
    if (!hasConnectionShape(created)) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    this.#connection = created;
    this.#consumerStatus = status;
    created.on("error", ignoreConnectionError);
    try {
      await created.onConnect(this.#options.connectTimeoutMs);
      const publisher: unknown = created.createPublisher({ confirm: true });
      if (!hasPublisherShape(publisher)) {
        throw brokerSdkShapeFailure(transportName, packageName);
      }
      this.#publisher = publisher;
    } catch (error) {
      this.#connection = undefined;
      this.#consumerStatus = undefined;
      await closeConnection(created);
      throw error;
    }
  }

  protected async publishMessage(
    destination: string,
    payload: Uint8Array,
    _replyTo: string | undefined,
  ): Promise<void> {
    const publisher = this.#requirePublisher();
    await publisher.send(destination, payload);
  }

  protected async openSubscription(
    subscription: TransportSubscription,
    handler: TransportHandler,
  ): Promise<TransportSubscriptionHandle> {
    const connection = this.#requireConnection();
    const status = this.#requireConsumerStatus();
    const created: unknown = connection.createConsumer(
      {
        queue: subscription.destination,
        qos: { prefetchCount: this.#options.prefetch },
      },
      async (message) => {
        try {
          const body = message?.body;
          if (!(body instanceof Uint8Array)) {
            return status.ACK;
          }
          const delivered: TransportMessage = Object.freeze({ payload: body });
          const decision = await handler(delivered);
          return decision === "nack" ? status.REQUEUE : status.ACK;
        } catch {
          return status.REQUEUE;
        }
      },
    );
    if (!hasConsumerShape(created)) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    let closed = false;
    return Object.freeze({
      close: async (): Promise<void> => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          await created.close();
        } catch {
          // Closing is terminal; a broken channel cannot keep the handle open.
        }
      },
    });
  }

  protected async release(): Promise<void> {
    const publisher = this.#publisher;
    const connection = this.#connection;
    this.#publisher = undefined;
    this.#connection = undefined;
    this.#consumerStatus = undefined;
    if (publisher !== undefined) {
      try {
        await publisher.close();
      } catch {
        // The connection close below is the fallback for a broken publisher channel.
      }
    }
    if (connection !== undefined) {
      await closeConnection(connection);
    }
  }

  #requireConnection(): RabbitMqSdkConnection {
    const connection = this.#connection;
    if (connection === undefined) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    return connection;
  }

  #requirePublisher(): RabbitMqSdkPublisher {
    const publisher = this.#publisher;
    if (publisher === undefined) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    return publisher;
  }

  #requireConsumerStatus(): RabbitMqSdkConsumerStatus {
    const status = this.#consumerStatus;
    if (status === undefined) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    return status;
  }
}

function resolveOptions(options: RabbitMqTransportOptions): ResolvedRabbitMqOptions {
  const issues = [
    options.url === undefined ? "url is required" : optionalBrokerStringIssue(options.url, "url"),
    options.prefetch === undefined ? undefined : positiveIntegerIssue(options.prefetch, "prefetch"),
    options.connectTimeoutMs === undefined
      ? undefined
      : positiveIntegerIssue(options.connectTimeoutMs, "connectTimeoutMs"),
    options.name === undefined ? undefined : brokerIdentifierIssue(options.name, "name"),
  ];
  const collected = brokerOptionsIssues(issues);
  if (collected.length > 0) {
    throw invalidMicroserviceOptions("RabbitMQ transport options", collected);
  }
  return Object.freeze({
    url: options.url,
    prefetch: options.prefetch ?? defaultPrefetch,
    connectTimeoutMs: options.connectTimeoutMs ?? defaultConnectTimeoutMs,
    name: options.name ?? transportName,
  });
}

function hasConsumerStatusShape(value: unknown): value is RabbitMqSdkConsumerStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const status = value as Record<string, unknown>;
  return typeof status["ACK"] === "number" && typeof status["REQUEUE"] === "number";
}

function hasConnectionShape(value: unknown): value is RabbitMqSdkConnection {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const connection = value as Record<string, unknown>;
  return (
    typeof connection["onConnect"] === "function" &&
    typeof connection["on"] === "function" &&
    typeof connection["close"] === "function" &&
    typeof connection["createPublisher"] === "function" &&
    typeof connection["createConsumer"] === "function"
  );
}

function hasPublisherShape(value: unknown): value is RabbitMqSdkPublisher {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const publisher = value as Record<string, unknown>;
  return typeof publisher["send"] === "function" && typeof publisher["close"] === "function";
}

function hasConsumerShape(value: unknown): value is RabbitMqSdkConsumer {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["close"] === "function"
  );
}

async function closeConnection(connection: RabbitMqSdkConnection): Promise<void> {
  try {
    await connection.close();
  } catch {
    // Closing is terminal; the connection is released either way.
  }
}

/** Keeps an emitted SDK error from surfacing as an unhandled event. */
function ignoreConnectionError(): void {
  // Connection failures are reported through the operation that saw them.
}

async function loadRabbitMqSdk(): Promise<RabbitMqSdkModule> {
  return (await import("rabbitmq-client")) as unknown as RabbitMqSdkModule;
}
