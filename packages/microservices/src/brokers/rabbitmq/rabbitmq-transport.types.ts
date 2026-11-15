import type { BrokerSdkLoader } from "../shared/broker-sdk.ts";

/** The options `rabbitmqTransport` validates and freezes. */
export interface RabbitMqTransportOptions {
  /** The AMQP connection URL; required. */
  readonly url: string;
  /** The per-consumer prefetch count; defaults to 64. */
  readonly prefetch?: number;
  /** How long one connect attempt may take; defaults to 10 seconds. */
  readonly connectTimeoutMs?: number;
  /** The name reported in failures and diagnostics; defaults to `rabbitmq`. */
  readonly name?: string;
}

/** One message the RabbitMQ consumer callback receives. */
export interface RabbitMqSdkMessage {
  readonly body: Uint8Array;
}

/** The ACK, REQUEUE, and DROP values the SDK's `ConsumerStatus` exposes. */
export interface RabbitMqSdkConsumerStatus {
  readonly ACK: number;
  readonly REQUEUE: number;
  readonly DROP: number;
}

/** The properties one consumer is created with. */
export interface RabbitMqSdkConsumerOptions {
  readonly queue: string;
  readonly qos: { readonly prefetchCount: number };
}

/** The result one consumer callback returns to settle its delivery. */
export type RabbitMqSdkConsumerCallback = (message: RabbitMqSdkMessage) => Promise<number> | number;

/** One consumer the connection creates. */
export interface RabbitMqSdkConsumer {
  close(): Promise<void> | void;
}

/** The publisher properties this adapter passes. */
export interface RabbitMqSdkPublisherOptions {
  readonly confirm: boolean;
}

/** One confirmed publisher the connection creates. */
export interface RabbitMqSdkPublisher {
  send(queue: string, body: Uint8Array): Promise<unknown>;
  close(): Promise<void>;
}

/** The connection surface this adapter uses. */
export interface RabbitMqSdkConnection {
  onConnect(timeout?: number): Promise<void>;
  on(event: "error", listener: (error: unknown) => void): unknown;
  close(): Promise<void>;
  createPublisher(options: RabbitMqSdkPublisherOptions): RabbitMqSdkPublisher;
  createConsumer(
    options: RabbitMqSdkConsumerOptions,
    callback: RabbitMqSdkConsumerCallback,
  ): RabbitMqSdkConsumer;
}

/** The constructor the module exposes as its connection class. */
export type RabbitMqSdkConstructor = new (
  url: string,
  options?: { readonly connectionTimeout?: number },
) => RabbitMqSdkConnection;

/** The module surface this adapter uses. */
export interface RabbitMqSdkModule {
  readonly Connection?: RabbitMqSdkConstructor;
  readonly default?: RabbitMqSdkConstructor;
  readonly ConsumerStatus?: RabbitMqSdkConsumerStatus;
}

/** The test seam one adapter accepts instead of the literal SDK import. */
export type RabbitMqSdkLoader = BrokerSdkLoader<RabbitMqSdkModule>;
