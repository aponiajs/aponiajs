import {
  brokerGroupIssue,
  brokerIdentifierIssue,
  brokerOptionsIssues,
  positiveIntegerIssue,
} from "../shared/broker-config.ts";
import { brokerSdkShapeFailure, loadBrokerSdk } from "../shared/broker-sdk.ts";
import { BrokerTransport } from "../shared/broker-transport.ts";
import {
  invalidMicroserviceOptions,
  isTransportString,
  maximumTransportDestinationLength,
} from "../../transport/transport-validation.ts";
import type {
  TransportDecision,
  TransportHandler,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "../../transport/transport.types.ts";
import type {
  RedisSdkClient,
  RedisSdkLoader,
  RedisSdkModule,
  RedisStreamFields,
  RedisStreamMessage,
  RedisTransportOptions,
} from "./redis-transport.types.ts";

const transportName = "redis";
const packageName = "redis";
const defaultBlockMs = 5_000;
const defaultBatchSize = 10;
const defaultConnectTimeoutMs = 10_000;
const reclaimIdleMs = 60_000;
const reclaimStart = "0-0";
const newMessagesId = ">";
const streamStartId = "0";
const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
const utf8 = new TextDecoder();

interface ResolvedRedisOptions {
  readonly url: string;
  readonly consumerGroup: string;
  readonly consumerName: string;
  readonly blockMs: number;
  readonly batchSize: number;
  readonly connectTimeoutMs: number;
  readonly name: string;
}

interface SubscriptionState {
  closed: boolean;
}

/**
 * Creates a Redis Streams transport.
 *
 * Publishing uses `XADD` with one base64 `payload` field, because the client
 * decodes bulk strings to text and the envelope is binary. Subscribing uses a
 * dedicated duplicated connection per subscription so a blocking `XREADGROUP`
 * cannot hold the publisher connection. This adapter does not use Redis
 * Pub/Sub.
 *
 * Redis has no reply field, so the encoded envelope carries the reply stream.
 * The generated consumer group is unique per transport instance; server
 * replicas that must load balance a shared subscription have to set
 * `consumerGroup` in their server transport options.
 *
 * @param options - URL, group and consumer identity, read bounds, and timeout.
 * @returns A transport whose `connect` must succeed before use.
 * @throws `AponiaError` with `INVALID_MICROSERVICE_OPTIONS` when an option is invalid.
 */
export function redisTransport(options: RedisTransportOptions): RedisTransport {
  return new RedisTransport(options);
}

/**
 * The Redis Streams adapter.
 *
 * Each subscription owns a duplicated client, creates its consumer group with
 * `MKSTREAM`, reclaims entries idle for at least 60 seconds before every read,
 * and acknowledges only a handler decision of `"ack"`. A `"nack"` or a handler
 * failure leaves the entry pending so `XAUTOCLAIM` retries it later.
 *
 * @internal
 */
export class RedisTransport extends BrokerTransport {
  readonly #options: ResolvedRedisOptions;
  readonly #loader: RedisSdkLoader;
  #client: RedisSdkClient | undefined;

  constructor(options: RedisTransportOptions, loader?: RedisSdkLoader) {
    const resolved = resolveOptions(options);
    super(resolved.name);
    this.#options = resolved;
    this.#loader = loader ?? loadRedisSdk;
  }

  protected async open(): Promise<void> {
    const module = await loadBrokerSdk(transportName, packageName, this.#loader);
    if (typeof module.createClient !== "function") {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    const client = module.createClient({
      url: this.#options.url,
      socket: { connectTimeout: this.#options.connectTimeoutMs },
    });
    if (typeof client !== "object" || client === null || typeof client.connect !== "function") {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    try {
      await client.connect();
    } catch (error) {
      await disconnectQuietly(client);
      throw error;
    }
    this.#client = client;
  }

  protected async publishMessage(
    destination: string,
    payload: Uint8Array,
    _replyTo: string | undefined,
  ): Promise<void> {
    const client = this.#requireClient();
    await client.xAdd(destination, "*", {
      payload: Buffer.from(payload).toString("base64"),
    });
  }

  protected async openSubscription(
    subscription: TransportSubscription,
    handler: TransportHandler,
  ): Promise<TransportSubscriptionHandle> {
    const group = subscription.consumerGroup ?? this.#options.consumerGroup;
    const consumerClient = this.#requireClient().duplicate();
    const state: SubscriptionState = { closed: false };
    try {
      await consumerClient.connect();
      await this.#ensureGroup(consumerClient, subscription.destination, group);
    } catch (error) {
      await disconnectQuietly(consumerClient);
      throw error;
    }

    void this.#consume(consumerClient, subscription.destination, group, handler, state);

    return Object.freeze({
      close: async () => {
        if (state.closed) {
          return;
        }
        state.closed = true;
        await disconnectQuietly(consumerClient);
      },
    });
  }

  protected async release(): Promise<void> {
    const client = this.#client;
    this.#client = undefined;
    if (client !== undefined) {
      await disconnectQuietly(client);
    }
  }

  async #ensureGroup(client: RedisSdkClient, destination: string, group: string): Promise<void> {
    try {
      await client.xGroupCreate(destination, group, streamStartId, { MKSTREAM: true });
    } catch (error) {
      if (!isBusyGroup(error)) {
        throw error;
      }
    }
  }

  async #consume(
    client: RedisSdkClient,
    destination: string,
    group: string,
    handler: TransportHandler,
    state: SubscriptionState,
  ): Promise<void> {
    const consumer = this.#options.consumerName;
    while (!state.closed) {
      try {
        const claimed = await client.xAutoClaim(
          destination,
          group,
          consumer,
          reclaimIdleMs,
          reclaimStart,
          { COUNT: this.#options.batchSize },
        );
        if (state.closed) {
          return;
        }
        await this.#dispatch(client, destination, group, handler, claimed.messages, state);
        if (state.closed) {
          return;
        }

        const read = await client.xReadGroup(
          group,
          consumer,
          [{ key: destination, id: newMessagesId }],
          { COUNT: this.#options.batchSize, BLOCK: this.#options.blockMs },
        );
        if (state.closed) {
          return;
        }
        if (read !== null) {
          for (const stream of read) {
            await this.#dispatch(client, destination, group, handler, stream.messages, state);
            if (state.closed) {
              return;
            }
          }
        }
      } catch {
        // A failing SDK command stops this subscription rather than becoming an
        // unhandled rejection. Terminal close is the only recovery.
        return;
      }
    }
  }

  async #dispatch(
    client: RedisSdkClient,
    destination: string,
    group: string,
    handler: TransportHandler,
    messages: readonly (RedisStreamMessage | null)[],
    state: SubscriptionState,
  ): Promise<void> {
    for (const message of messages) {
      if (message === null || state.closed) {
        continue;
      }
      const payload = decodePayload(message);
      if (payload === undefined) {
        // A producer outside this framework wrote an undecodable entry. Leaving
        // it pending lets XAUTOCLAIM retry it instead of silently dropping it.
        continue;
      }
      const decision = await decide(handler, payload);
      if (state.closed) {
        return;
      }
      if (decision === "ack") {
        await client.xAck(destination, group, message.id);
      }
    }
  }

  #requireClient(): RedisSdkClient {
    const client = this.#client;
    if (client === undefined) {
      throw brokerSdkShapeFailure(transportName, packageName);
    }
    return client;
  }
}

async function decide(
  handler: TransportHandler,
  payload: Uint8Array,
): Promise<TransportDecision | undefined> {
  try {
    return await handler(Object.freeze({ payload }));
  } catch {
    // A handler failure leaves the entry pending for redelivery.
    return undefined;
  }
}

function decodePayload(message: RedisStreamMessage): Uint8Array | undefined {
  const encoded = readField(message.message);
  if (encoded === undefined || !isBase64(encoded)) {
    return undefined;
  }
  return Buffer.from(encoded, "base64");
}

function readField(fields: RedisStreamFields): string | undefined {
  const value = isFieldMap(fields) ? fields.get("payload") : fields.payload;
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return utf8.decode(value);
  }
  return undefined;
}

function isFieldMap(fields: RedisStreamFields): fields is ReadonlyMap<string, string | Uint8Array> {
  return fields instanceof Map;
}

function isBase64(value: string): boolean {
  if (value.length % 4 !== 0) {
    return false;
  }
  return base64Pattern.test(value);
}

function isBusyGroup(error: unknown): boolean {
  return error instanceof Error && error.message.includes("BUSYGROUP");
}

async function disconnectQuietly(client: RedisSdkClient): Promise<void> {
  try {
    await client.disconnect();
  } catch {
    // Close is terminal; an SDK that cannot disconnect has nothing left to do.
  }
}

function resolveOptions(options: RedisTransportOptions): ResolvedRedisOptions {
  const name = options.name ?? transportName;
  const issues = [
    urlIssue(options.url),
    options.consumerGroup === undefined
      ? undefined
      : brokerGroupIssue(options.consumerGroup, "consumerGroup"),
    options.consumerName === undefined
      ? undefined
      : brokerGroupIssue(options.consumerName, "consumerName"),
    options.blockMs === undefined ? undefined : positiveIntegerIssue(options.blockMs, "blockMs"),
    options.batchSize === undefined
      ? undefined
      : positiveIntegerIssue(options.batchSize, "batchSize"),
    options.connectTimeoutMs === undefined
      ? undefined
      : positiveIntegerIssue(options.connectTimeoutMs, "connectTimeoutMs"),
    options.name === undefined ? undefined : brokerIdentifierIssue(options.name, "name"),
  ];
  const collected = brokerOptionsIssues(issues);
  if (collected.length > 0) {
    throw invalidMicroserviceOptions("Redis transport options", collected);
  }
  return Object.freeze({
    url: options.url,
    consumerGroup: options.consumerGroup ?? `aponia-${name}-${crypto.randomUUID()}`,
    consumerName: options.consumerName ?? `${name}-${crypto.randomUUID()}`,
    blockMs: options.blockMs ?? defaultBlockMs,
    batchSize: options.batchSize ?? defaultBatchSize,
    connectTimeoutMs: options.connectTimeoutMs ?? defaultConnectTimeoutMs,
    name,
  });
}

function urlIssue(value: unknown): string | undefined {
  if (!isTransportString(value, maximumTransportDestinationLength)) {
    return "url must be a non-empty string of at most 2048 characters";
  }
  if (/\s/.test(value)) {
    return "url must not contain whitespace";
  }
  return undefined;
}

async function loadRedisSdk(): Promise<RedisSdkModule> {
  return (await import("redis")) as unknown as RedisSdkModule;
}
