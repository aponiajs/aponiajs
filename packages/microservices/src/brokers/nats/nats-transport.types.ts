import type { BrokerSdkLoader } from "../shared/broker-sdk.ts";

/** The options `natsTransport` validates and freezes. */
export interface NatsTransportOptions {
  /** One server or a list of servers; defaults to `127.0.0.1:4222`. */
  readonly servers?: string | readonly string[];
  /** The user name the server authenticates. */
  readonly user?: string;
  /** The password paired with `user`. */
  readonly pass?: string;
  /** A token the server authenticates instead of a user and password. */
  readonly token?: string;
  /** How long one connect attempt may take; defaults to 10 seconds. */
  readonly connectTimeoutMs?: number;
  /** The name reported in failures and NATS diagnostics; defaults to `nats`. */
  readonly name?: string;
}

/** One message the NATS client delivers to a subscription callback. */
export interface NatsDeliveredMessage {
  readonly data: Uint8Array;
  readonly reply?: string;
  readonly subject: string;
}

/** One NATS subscription. */
export interface NatsSdkSubscription {
  drain(): Promise<void>;
  unsubscribe(): void;
}

/** The connection surface this adapter uses. */
export interface NatsSdkConnection {
  publish(subject: string, payload?: Uint8Array, options?: { readonly reply?: string }): void;
  subscribe(
    subject: string,
    options: {
      readonly queue?: string;
      readonly callback: (error: Error | null, message: NatsDeliveredMessage) => void;
    },
  ): NatsSdkSubscription;
  drain(): Promise<void>;
  close(): void;
}

/** The connect options this adapter passes. */
export interface NatsSdkConnectOptions {
  readonly servers: string | readonly string[];
  readonly timeout: number;
  readonly name: string;
  readonly user?: string;
  readonly pass?: string;
  readonly token?: string;
}

/** The module surface this adapter uses. */
export interface NatsSdkModule {
  connect(options: NatsSdkConnectOptions): Promise<NatsSdkConnection>;
}

/** The test seam one adapter accepts instead of the literal SDK import. */
export type NatsSdkLoader = BrokerSdkLoader<NatsSdkModule>;
