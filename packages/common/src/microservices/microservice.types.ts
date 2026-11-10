import type { MessagePatternKind } from "./message-pattern.ts";

/**
 * One message a transport delivers to the application.
 *
 * `kind` states whether the message expects a reply, `pattern` is the
 * canonical handler key, and `data` is the payload the client sent. `id` is
 * the client's correlation identifier, `target` names the service the message
 * was addressed to, and `replyTo` is the transport-private destination a reply
 * is published to when the transport cannot answer in place.
 *
 * `transport` names the transport that delivered the message so a handler can
 * tell two transports apart.
 */
export interface MicroserviceMessage {
  /** The client-generated correlation identifier, unique per request. */
  readonly id: string;
  /** Whether the handler answers the caller or only observes the message. */
  readonly kind: MessagePatternKind;
  /** The canonical handler key the client addressed. */
  readonly pattern: string;
  /** The payload the client sent, unchanged. */
  readonly data: unknown;
  /** The service the message was addressed to; defaults to `default`. */
  readonly target: string;
  /** The transport-private reply destination, when one was supplied. */
  readonly replyTo?: string;
  /** The transport that delivered this message. */
  readonly transport: string;
}

/** The client-visible failure a message handler records. */
export interface MicroserviceFailure {
  /** A stable code, never a stack or an internal cause. */
  readonly code: string;
  /** A sentence safe to return to the caller. */
  readonly message: string;
}

/**
 * What a transport returns to its caller for one message.
 *
 * A request/response transport returns `value`; an event transport discards
 * it. A failure travels as data rather than as a thrown error, so every
 * transport serializes the same shape and no stack or cause crosses the wire.
 */
export type MicroserviceReply =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: MicroserviceFailure };

/** Receives one delivered message and answers it. */
export type MicroserviceHandler = (message: MicroserviceMessage) => Promise<MicroserviceReply>;

/**
 * What the application hands a transport at boot.
 *
 * A transport is the only platform-specific half of messaging: it owns the
 * wire (an in-process bus, a broker, a socket), while the application owns
 * handler lookup, payload binding, and the reply contract. `subscribe` is
 * called once per boot with the application's dispatcher, after every provider
 * and controller exists; `close` runs on application shutdown, before module
 * destroy hooks, and must stop delivering new messages.
 */
export interface MicroserviceTransport {
  /** A stable name reported to handlers and in boot diagnostics. */
  readonly name: string;
  /** Starts delivering messages to the application's dispatcher. */
  subscribe(handler: MicroserviceHandler): Promise<void> | void;
  /** Stops delivery and releases the transport's own resources. */
  close(): Promise<void> | void;
}
