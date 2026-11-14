import type { LoggerService, MicroserviceTransport } from "@aponiajs/common";
import type { Transport, TransportSubscription } from "../transport/transport.types.ts";

/** The options `createMicroserviceServer` validates and freezes. */
export interface MicroserviceServerConfig {
  /** The broker adapter the server consumes and replies through. */
  readonly transport: Transport;
  /** The destinations this service consumes; at least one is required. */
  readonly subscriptions: readonly TransportSubscription[];
  /** The service this server answers; defaults to `default`. */
  readonly target?: string;
  /** The name reported in boot diagnostics; defaults to the transport name. */
  readonly name?: string;
  /**
   * The reply destinations a request may name.
   *
   * When set, a reply is published only to an exact member of this list. The
   * destination usually belongs to this service's own reply namespace. When
   * omitted, the envelope's destination is trusted; a deployment that accepts
   * requests from untrusted producers should always set it.
   */
  readonly replyDestinations?: readonly string[];
  /** The most handlers that may run at once; defaults to 1,000. */
  readonly maxInFlight?: number;
  /** How long the transport may take to connect; defaults to 10 seconds. */
  readonly connectTimeoutMs?: number;
  /** How long one subscription or the transport may take to close; defaults to 5 seconds. */
  readonly closeTimeoutMs?: number;
  /** Optional diagnostics; failures are always reported without payloads or credentials. */
  readonly logger?: LoggerService;
}

/**
 * A message-pattern server over one broker transport.
 *
 * It implements the boot contract an application accepts in
 * `AponiaFactory.create({ microservices: [...] })`: `subscribe` opens the
 * broker connection and every configured subscription, and `close` releases
 * them. The server is terminal after `close`.
 */
export interface MicroserviceServer extends MicroserviceTransport {
  /** The service this server answers. */
  readonly target: string;
  /** Stops delivery and releases every subscription and the transport. */
  close(): Promise<void>;
}
