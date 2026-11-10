import {
  brokerDestinationIssue,
  brokerIdentifierIssue,
  brokerOptionsIssues,
  booleanIssue,
  positiveIntegerIssue,
} from "../shared/broker-config.ts";
import { brokerSdkShapeFailure, loadBrokerSdk } from "../shared/broker-sdk.ts";
import { BrokerTransport } from "../shared/broker-transport.ts";
import {
  invalidMicroserviceOptions,
  maximumTransportGroupLength,
} from "../../transport/transport-validation.ts";
import type {
  TransportHandler,
  TransportMessage,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "../../transport/transport.types.ts";
import type {
  KafkaEachMessagePayload,
  KafkaSdkClient,
  KafkaSdkConsumer,
  KafkaSdkLoader,
  KafkaSdkModule,
  KafkaSdkProducer,
  KafkaTransportOptions,
} from "./kafka-transport.types.ts";

const transportName = "kafka";
const packageName = "kafkajs";
const defaultConnectTimeoutMs = 10_000;
const kafkaGroupPattern = /^[A-Za-z0-9._-]+$/;

interface ResolvedKafkaOptions {
  readonly brokers: readonly string[];
  readonly clientId: string;
  readonly groupId: string;
  readonly fromBeginning: boolean;
  readonly connectTimeoutMs: number;
  readonly name: string;
}

interface SubscriptionState {
  stopped: boolean;
}

/**
 * Creates a Kafka transport.
 *
 * Every subscription runs its own consumer. Kafka has no reply field, so the
 * encoded envelope carries the reply topic; the `replyTo` argument is ignored.
 * A generated consumer group is unique per transport instance, which keeps two
 * clients from dividing one another's replies; replicas that must balance a
 * shared subscription have to set `groupId` or `consumerGroup` explicitly.
 *
 * @param options - Brokers, client identity, group, offset policy, and timeout.
 * @returns A transport whose `connect` must succeed before use.
 * @throws `AponiaError` with `INVALID_MICROSERVICE_OPTIONS` when an option is invalid.
 */
export function kafkaTransport(options: KafkaTransportOptions): KafkaTransport {
  return new KafkaTransport(options);
}

/**
 * The Kafka adapter.
 *
 * Offsets are committed only after a handler returns `"ack"`. A `"nack"`, a
 * handler failure, or a failed commit pauses that topic and partition without
 * committing, so the lane stalls until the process restarts and resumes from
 * the last committed offset.
 *
 * @internal
 */
export class KafkaTransport extends BrokerTransport {
  readonly #options: ResolvedKafkaOptions;
  readonly #loader: KafkaSdkLoader;
  #client: KafkaSdkClient | undefined;
  #producer: KafkaSdkProducer | undefined;

  constructor(options: KafkaTransportOptions, loader?: KafkaSdkLoader) {
    const resolved = resolveOptions(options);
    super(resolved.name);
    this.#options = resolved;
    this.#loader = loader ?? loadKafkaSdk;
  }

  /**
   * Refuses a consumer group Kafka cannot accept before the base opens a
   * subscription, so the caller receives `INVALID_MICROSERVICE_OPTIONS`.
   */
  override async subscribe(
    subscription: TransportSubscription,
    handler: TransportHandler,
  ): Promise<TransportSubscriptionHandle> {
    this.assertOpen();
    if (subscription.consumerGroup !== undefined) {
      const issue = kafkaGroupIssue(subscription.consumerGroup, "subscription.consumerGroup");
      if (issue !== undefined) {
        throw invalidMicroserviceOptions("Kafka transport subscription", [issue]);
      }
    }
    return super.subscribe(subscription, handler);
  }

  protected async open(): Promise<void> {
    const module = await loadBrokerSdk(transportName, packageName, this.#loader);
    if (typeof module.Kafka !== "function") {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    const client = new module.Kafka({
      clientId: this.#options.clientId,
      brokers: this.#options.brokers,
      connectionTimeout: this.#options.connectTimeoutMs,
    });
    if (typeof client !== "object" || client === null || typeof client.producer !== "function") {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    const producer = client.producer();
    if (
      typeof producer !== "object" ||
      producer === null ||
      typeof producer.connect !== "function"
    ) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    try {
      await producer.connect();
    } catch (error) {
      await disconnectQuietly(producer);
      throw error;
    }
    this.#client = client;
    this.#producer = producer;
  }

  protected async publishMessage(
    destination: string,
    payload: Uint8Array,
    _replyTo: string | undefined,
  ): Promise<void> {
    const producer = this.#requireProducer();
    await producer.send({
      topic: destination,
      messages: [{ value: payload }],
      acks: -1,
    });
  }

  protected async openSubscription(
    subscription: TransportSubscription,
    handler: TransportHandler,
  ): Promise<TransportSubscriptionHandle> {
    const client = this.#requireClient();
    const groupId = subscription.consumerGroup ?? this.#options.groupId;
    const consumer = client.consumer({ groupId });
    const state: SubscriptionState = { stopped: false };
    try {
      await consumer.connect();
      await consumer.subscribe({
        topic: subscription.destination,
        fromBeginning: this.#options.fromBeginning,
      });
      const running = consumer.run({
        autoCommit: false,
        eachMessage: async (payload) => {
          if (state.stopped) {
            return;
          }
          await this.#handleMessage(consumer, payload, handler, state);
        },
      });
      void Promise.resolve(running).catch(() => {
        state.stopped = true;
      });
    } catch (error) {
      await disconnectQuietly(consumer);
      throw error;
    }

    let closed = false;
    return Object.freeze({
      close: async () => {
        if (closed) {
          return;
        }
        closed = true;
        await disconnectQuietly(consumer);
      },
    });
  }

  protected async release(): Promise<void> {
    const producer = this.#producer;
    this.#producer = undefined;
    this.#client = undefined;
    if (producer !== undefined) {
      await disconnectQuietly(producer);
    }
  }

  async #handleMessage(
    consumer: KafkaSdkConsumer,
    payload: KafkaEachMessagePayload,
    handler: TransportHandler,
    state: SubscriptionState,
  ): Promise<void> {
    try {
      const nextOffset = incrementOffset(payload.message.offset);
      const value = payload.message.value;
      if (value === null) {
        // A tombstone carries no envelope; committing it keeps the partition
        // moving without inventing a delivery the handler cannot decode.
        if (nextOffset === undefined) {
          state.stopped = true;
          await stopPartition(consumer, payload.topic, payload.partition);
          return;
        }
        await commit(consumer, payload, nextOffset);
        return;
      }

      const decision = await handler(toTransportMessage(value));
      if (decision !== "ack" || nextOffset === undefined) {
        state.stopped = true;
        await stopPartition(consumer, payload.topic, payload.partition);
        return;
      }
      await commit(consumer, payload, nextOffset);
    } catch {
      // The handler failed, or the commit did. Neither may throw out of the
      // Kafka callback, and neither may advance the committed offset.
      state.stopped = true;
      await stopPartition(consumer, payload.topic, payload.partition);
    }
  }

  #requireClient(): KafkaSdkClient {
    const client = this.#client;
    if (client === undefined) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    return client;
  }

  #requireProducer(): KafkaSdkProducer {
    const producer = this.#producer;
    if (producer === undefined) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    return producer;
  }
}

function toTransportMessage(payload: Uint8Array): TransportMessage {
  return Object.freeze({ payload });
}

function incrementOffset(offset: string): string | undefined {
  if (!/^[0-9]+$/.test(offset)) {
    return undefined;
  }
  return (BigInt(offset) + 1n).toString();
}

async function commit(
  consumer: KafkaSdkConsumer,
  payload: KafkaEachMessagePayload,
  offset: string,
): Promise<void> {
  await consumer.commitOffsets([{ topic: payload.topic, partition: payload.partition, offset }]);
}

async function stopPartition(
  consumer: KafkaSdkConsumer,
  topic: string,
  partition: number,
): Promise<void> {
  try {
    await consumer.pause([{ topic, partitions: [partition] }]);
  } catch {
    // The lane is already unable to commit; a pause that also fails leaves the
    // consumer waiting rather than committing past the failure.
  }
}

async function disconnectQuietly(client: { disconnect(): Promise<void> }): Promise<void> {
  try {
    await client.disconnect();
  } catch {
    // Close is terminal; an SDK that cannot disconnect has nothing left to do.
  }
}

function resolveOptions(options: KafkaTransportOptions): ResolvedKafkaOptions {
  const issues = [
    brokersIssue(options.brokers),
    brokerIdentifierIssue(options.clientId, "clientId"),
    options.groupId === undefined ? undefined : kafkaGroupIssue(options.groupId, "groupId"),
    booleanIssue(options.fromBeginning, "fromBeginning"),
    options.connectTimeoutMs === undefined
      ? undefined
      : positiveIntegerIssue(options.connectTimeoutMs, "connectTimeoutMs"),
    options.name === undefined ? undefined : brokerIdentifierIssue(options.name, "name"),
  ];
  const collected = brokerOptionsIssues(issues);
  if (collected.length > 0) {
    throw invalidMicroserviceOptions("Kafka transport options", collected);
  }
  return Object.freeze({
    brokers: Object.freeze([...options.brokers]),
    clientId: options.clientId,
    groupId: options.groupId ?? generatedGroupId(options.clientId),
    fromBeginning: options.fromBeginning ?? false,
    connectTimeoutMs: options.connectTimeoutMs ?? defaultConnectTimeoutMs,
    name: options.name ?? transportName,
  });
}

function brokersIssue(brokers: unknown): string | undefined {
  if (!Array.isArray(brokers) || brokers.length === 0) {
    return "brokers must be a non-empty list of host:port addresses";
  }
  const addresses: readonly unknown[] = brokers;
  for (const address of addresses) {
    if (kafkaBrokerIssue(address, "brokers") !== undefined) {
      return "brokers must contain only host:port addresses with a port between 1 and 65535";
    }
  }
  return undefined;
}

function kafkaBrokerIssue(value: unknown, field: string): string | undefined {
  if (brokerDestinationIssue(value, field) !== undefined) {
    return `${field} must be a host:port address`;
  }
  const address = value as string;
  const separator = address.lastIndexOf(":");
  if (separator < 1 || separator === address.length - 1) {
    return `${field} must be a host:port address`;
  }
  const host = address.slice(0, separator);
  const port = address.slice(separator + 1);
  if (!/^[A-Za-z0-9._:[\]-]+$/.test(host)) {
    return `${field} must be a host:port address`;
  }
  if (!/^[0-9]{1,5}$/.test(port)) {
    return `${field} must have a numeric port between 1 and 65535`;
  }
  const numeric = Number(port);
  if (numeric < 1 || numeric > 65535) {
    return `${field} must have a numeric port between 1 and 65535`;
  }
  return undefined;
}

/**
 * Reports the first reason a Kafka consumer group is invalid.
 *
 * Kafka accepts only letters, digits, `.`, `_`, and `-`. A supplied group is
 * refused rather than rewritten, because a silently rewritten group would
 * deliver to a lane the operator did not configure.
 */
function kafkaGroupIssue(value: unknown, field: string): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumTransportGroupLength
  ) {
    return `${field} must be a non-empty string of at most ${maximumTransportGroupLength} characters`;
  }
  if (!kafkaGroupPattern.test(value)) {
    return `${field} must contain only letters, digits, ".", "_", or "-"`;
  }
  return undefined;
}

function generatedGroupId(clientId: string): string {
  const prefix = clientId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${prefix}-${crypto.randomUUID()}`;
}

async function loadKafkaSdk(): Promise<KafkaSdkModule> {
  return (await import("kafkajs")) as unknown as KafkaSdkModule;
}
