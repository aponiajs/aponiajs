import type { BrokerSdkLoader } from "../shared/broker-sdk.ts";

/**
 * The options `kafkaTransport` validates and freezes.
 *
 * `brokers` and `clientId` are required. A consumer group is generated per
 * transport instance when `groupId` is omitted; set `groupId` explicitly when
 * several server replicas must share one subscription.
 */
export interface KafkaTransportOptions {
  /** One or more `host:port` broker addresses. */
  readonly brokers: readonly string[];
  /** The client identifier Kafka records for this connection. */
  readonly clientId: string;
  /**
   * The default consumer group for subscriptions that do not name one.
   *
   * Kafka group identifiers may contain only letters, digits, `.`, `_`, and
   * `-`. A generated group is unique per transport instance.
   */
  readonly groupId?: string;
  /** Whether a new consumer group reads from the beginning; defaults to false. */
  readonly fromBeginning?: boolean;
  /** How long one connect attempt may take; defaults to 10 seconds. */
  readonly connectTimeoutMs?: number;
  /** The name reported in failures and diagnostics; defaults to `kafka`. */
  readonly name?: string;
}

/** One record a Kafka producer publishes. */
export interface KafkaProducerMessage {
  readonly value: Uint8Array;
}

/** The producer send options this adapter uses. */
export interface KafkaProducerSendOptions {
  readonly topic: string;
  readonly messages: readonly KafkaProducerMessage[];
  readonly acks: -1;
}

/** The producer surface this adapter uses. */
export interface KafkaSdkProducer {
  connect(): Promise<void>;
  send(options: KafkaProducerSendOptions): Promise<unknown>;
  disconnect(): Promise<void>;
}

/** One message Kafka delivers to `eachMessage`. */
export interface KafkaEachMessagePayload {
  readonly topic: string;
  readonly partition: number;
  readonly message: {
    readonly offset: string;
    readonly value: Uint8Array | null;
  };
}

/** The topic and partition pair Kafka accepts when pausing consumption. */
export interface KafkaTopicPartition {
  readonly topic: string;
  readonly partitions: readonly number[];
}

/** One offset Kafka accepts when committing manually. */
export interface KafkaOffset {
  readonly topic: string;
  readonly partition: number;
  readonly offset: string;
}

/** The consumer surface this adapter uses. */
export interface KafkaSdkConsumer {
  connect(): Promise<void>;
  subscribe(options: { readonly topic: string; readonly fromBeginning: boolean }): Promise<void>;
  run(options: {
    readonly autoCommit: false;
    readonly eachMessage: (payload: KafkaEachMessagePayload) => Promise<void>;
  }): Promise<void>;
  pause(topics: readonly KafkaTopicPartition[]): void | Promise<void>;
  commitOffsets(offsets: readonly KafkaOffset[]): Promise<void>;
  disconnect(): Promise<void>;
}

/** The Kafka client surface this adapter uses. */
export interface KafkaSdkClient {
  producer(): KafkaSdkProducer;
  consumer(options: { readonly groupId: string }): KafkaSdkConsumer;
}

/** The constructor options this adapter passes to Kafka. */
export interface KafkaSdkClientOptions {
  readonly clientId: string;
  readonly brokers: readonly string[];
  readonly connectionTimeout: number;
}

/** The module surface this adapter uses. */
export interface KafkaSdkModule {
  readonly Kafka: new (options: KafkaSdkClientOptions) => KafkaSdkClient;
}

/** The test seam one adapter accepts instead of the literal SDK import. */
export type KafkaSdkLoader = BrokerSdkLoader<KafkaSdkModule>;
