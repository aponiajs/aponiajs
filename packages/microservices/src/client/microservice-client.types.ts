import type { Transport } from "../transport/transport.types.ts";

/** The options `createMicroserviceClient` validates and freezes. */
export interface MicroserviceClientConfig {
  /** The broker adapter the client publishes through. */
  readonly transport: Transport;
  /** The broker destination requests and events are published to. */
  readonly destination: string;
  /** The broker destination this client subscribes to for replies. */
  readonly replyTo: string;
  /**
   * The broker destination this client subscribes to for replies when it
   * differs from `replyTo`.
   *
   * Cloud brokers separate the destination a reply is published to from the
   * subscription that receives it: a Pub/Sub reply topic and its per-client
   * subscription are distinct resources. Every other adapter defaults to
   * `replyTo`.
   */
  readonly replySubscription?: string;
  /** The service the messages are addressed to; defaults to `default`. */
  readonly target?: string;
  /** The name reported in failures; defaults to the transport name. */
  readonly name?: string;
  /** How long one request waits for its reply; defaults to 30 seconds. */
  readonly requestTimeoutMs?: number;
  /** How long the transport may take to connect; defaults to 10 seconds. */
  readonly connectTimeoutMs?: number;
  /** The most requests that may await a reply at once; defaults to 1,000. */
  readonly maxPendingCalls?: number;
}

/**
 * A client over one broker transport.
 *
 * `send` publishes a request and answers its reply; `emit` only confirms that
 * the broker accepted the event. A broker event has no response, so `emit`
 * cannot report that a handler ran. Every failure is a `MicroserviceCallError`
 * carrying a stable code; connect and close failures from the framework are
 * `AponiaError` values.
 */
export interface MicroserviceClient {
  /** The name reported in failures and diagnostics. */
  readonly name: string;
  /** The service this client addresses by default. */
  readonly target: string;
  /** Opens the transport and its reply subscription; repeated calls are no-ops. */
  connect(): Promise<void>;
  /** Sends a request and returns the handler's value. */
  send<T = unknown>(pattern: string | number, data?: unknown): Promise<T>;
  /** Publishes an event and waits for the broker to accept it. */
  emit(pattern: string | number, data?: unknown): Promise<void>;
  /** Rejects pending calls, stops delivery, and releases the transport. */
  close(): Promise<void>;
}
