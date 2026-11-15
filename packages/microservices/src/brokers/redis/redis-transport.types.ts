import type { BrokerSdkLoader } from "../shared/broker-sdk.ts";

/**
 * The options `redisTransport` validates and freezes.
 *
 * `url` is required. The generated consumer group and consumer name are
 * unique per transport instance so two clients never divide each other's
 * replies; replicas that must share a subscription have to set
 * `consumerGroup` explicitly.
 */
export interface RedisTransportOptions {
  /** The Redis connection URL, for example `redis://127.0.0.1:6379`. */
  readonly url: string;
  /** The default consumer group for subscriptions that do not name one. */
  readonly consumerGroup?: string;
  /** The consumer name used inside a Redis stream consumer group. */
  readonly consumerName?: string;
  /** How long one blocking read may wait; defaults to 5,000 milliseconds. */
  readonly blockMs?: number;
  /** The maximum entries read or reclaimed per call; defaults to 10. */
  readonly batchSize?: number;
  /** How long one connect attempt may take; defaults to 10 seconds. */
  readonly connectTimeoutMs?: number;
  /** The name reported in failures and diagnostics; defaults to `redis`. */
  readonly name?: string;
}

/** One value a Redis stream field may carry after the client decodes it. */
export type RedisStreamFieldValue = string | Uint8Array;

/** The fields of one delivered stream entry, as an object or a RESP3 map. */
export type RedisStreamFields =
  | Readonly<Record<string, RedisStreamFieldValue | undefined>>
  | ReadonlyMap<string, RedisStreamFieldValue>;

/** One entry a Redis stream delivers. */
export interface RedisStreamMessage {
  readonly id: string;
  readonly message: RedisStreamFields;
}

/** One stream and its entries, as `XREADGROUP` returns them. */
export interface RedisStreamReadResult {
  readonly name: string;
  readonly messages: readonly RedisStreamMessage[];
}

/** The entries `XAUTOCLAIM` reclaims. */
export interface RedisAutoClaimResult {
  readonly nextId: string;
  readonly messages: readonly (RedisStreamMessage | null)[];
}

/** The client options this adapter passes. */
export interface RedisSdkClientOptions {
  readonly url: string;
  readonly socket: {
    readonly connectTimeout: number;
  };
}

/** The Redis client surface this adapter uses. */
export interface RedisSdkClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  duplicate(): RedisSdkClient;
  xAdd(key: string, id: string, message: Readonly<Record<string, string>>): Promise<unknown>;
  xAck(key: string, group: string, id: string): Promise<number>;
  xAutoClaim(
    key: string,
    group: string,
    consumer: string,
    minIdleTime: number,
    start: string,
    options?: { readonly COUNT?: number },
  ): Promise<RedisAutoClaimResult>;
  xGroupCreate(
    key: string,
    group: string,
    id: string,
    options?: { readonly MKSTREAM?: boolean },
  ): Promise<unknown>;
  xReadGroup(
    group: string,
    consumer: string,
    streams: readonly { readonly key: string; readonly id: string }[],
    options?: { readonly COUNT?: number; readonly BLOCK?: number },
  ): Promise<readonly RedisStreamReadResult[] | null>;
}

/** The module surface this adapter uses. */
export interface RedisSdkModule {
  createClient(options: RedisSdkClientOptions): RedisSdkClient;
}

/** The test seam one adapter accepts instead of the literal SDK import. */
export type RedisSdkLoader = BrokerSdkLoader<RedisSdkModule>;
