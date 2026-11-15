/**
 * What a transport handler asks the broker to do with a delivered message.
 *
 * `ack` settles the delivery; `nack` returns it to the broker for redelivery
 * where the broker supports that. Brokers without per-message settlement
 * ignore the value.
 */
export type TransportDecision = "ack" | "nack";

/**
 * One message a broker delivered to a transport subscription.
 *
 * `payload` is the encoded envelope, untouched. `replyTo` is the
 * transport-native reply destination when the broker supplies one; it is a
 * hint beside the envelope's own destination, never a replacement for it.
 * A server only uses it after the same allowlist check that guards the
 * envelope destination.
 */
export interface TransportMessage {
  /** The encoded envelope bytes exactly as the broker delivered them. */
  readonly payload: Uint8Array;
  /** The broker-native reply destination, when the broker supplies one. */
  readonly replyTo?: string;
}

/** Receives one broker delivery and states whether it settled. */
export type TransportHandler = (
  message: TransportMessage,
) => Promise<TransportDecision> | TransportDecision;

/** The subscription a transport opens for one destination. */
export interface TransportSubscription {
  /** The broker destination: a topic, subject, queue, stream, or URL. */
  readonly destination: string;
  /**
   * The competing-consumer group, when the broker supports one.
   *
   * Adapters map it to their native mechanism: a NATS queue group, an MQTT
   * shared-subscription group, a Kafka consumer group, a Redis consumer
   * group, or a Pub/Sub subscription's own identity. A broker without a
   * group concept ignores it.
   */
  readonly consumerGroup?: string;
}

/** One open subscription a transport can close independently. */
export interface TransportSubscriptionHandle {
  /** Stops delivery and releases the subscription. */
  close(): Promise<void> | void;
}

/**
 * The SDK-neutral seam every broker adapter implements.
 *
 * A transport owns only the wire: connecting an SDK, publishing bytes,
 * receiving deliveries, and settling them. The client and server runtimes
 * above it own envelope encoding, correlation, dispatch, and policy. This is
 * deliberately separate from the application boot contract
 * `MicroserviceTransport`: a broker adapter is reusable by both the server
 * and the client, while the boot contract serves one application.
 *
 * A transport is terminal after `close()`. `connect()` is idempotent while
 * open; adapters are responsible for translating SDK failures into
 * `AponiaError` values whose codes and details are stable and whose messages
 * never contain credentials, payloads, or SDK internals.
 */
export interface Transport {
  /** The stable transport name reported in failures and boot diagnostics. */
  readonly name: string;
  /** Opens the underlying SDK connection. */
  connect(): Promise<void>;
  /**
   * Publishes one encoded envelope to a destination.
   *
   * `replyTo` is the destination the broker should answer on when its protocol
   * carries a reply field. Adapters that have no such field ignore it; the
   * envelope always carries the same destination for those brokers.
   */
  publish(destination: string, payload: Uint8Array, replyTo?: string): Promise<void>;
  /** Opens a subscription that delivers encoded envelopes in order of receipt. */
  subscribe(
    subscription: TransportSubscription,
    handler: TransportHandler,
  ): Promise<TransportSubscriptionHandle>;
  /** Stops every subscription and releases the SDK connection. */
  close(): Promise<void>;
}
