import type { BrokerSdkLoader } from "../shared/broker-sdk.ts";

/** The options `pubSubTransport` validates and freezes. */
export interface PubSubTransportOptions {
  /** The Google Cloud project; the SDK falls back to its own environment when omitted. */
  readonly projectId?: string;
  /** How many messages one subscription may hold in flight; defaults to 100. */
  readonly flowControlMaxMessages?: number;
  /** How long the client may take to load and construct; defaults to 10 seconds. */
  readonly connectTimeoutMs?: number;
  /** The name reported in failures; defaults to `gcp-pubsub`. */
  readonly name?: string;
}

/** The client options this adapter passes to `PubSub`. */
export interface PubSubSdkClientOptions {
  readonly projectId?: string;
}

/** The flow control this adapter asks a subscription for. */
export interface PubSubSdkFlowControl {
  readonly maxMessages: number;
}

/** The subscription options this adapter passes to `subscription`. */
export interface PubSubSdkSubscriptionOptions {
  readonly flowControl?: PubSubSdkFlowControl;
}

/** One message the SDK delivers to a subscription listener. */
export interface PubSubDeliveredMessage {
  readonly data: Uint8Array;
  ack(): void;
  nack(): void;
}

/** One SDK subscription. */
export interface PubSubSdkSubscription {
  on(event: "message", listener: (message: PubSubDeliveredMessage) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  close(): Promise<void>;
}

/** One SDK topic. */
export interface PubSubSdkTopic {
  publish(data: Uint8Array, attributes?: Record<string, string>): Promise<string>;
}

/** The `PubSub` client surface this adapter uses. */
export interface PubSubSdkClient {
  topic(name: string): PubSubSdkTopic;
  subscription(name: string, options?: PubSubSdkSubscriptionOptions): PubSubSdkSubscription;
  close(): Promise<void>;
}

/** The module surface this adapter uses. */
export interface PubSubSdkModule {
  readonly PubSub: new (options?: PubSubSdkClientOptions) => PubSubSdkClient;
}

/** The test seam this adapter accepts instead of the literal SDK import. */
export type PubSubSdkLoader = BrokerSdkLoader<PubSubSdkModule>;
