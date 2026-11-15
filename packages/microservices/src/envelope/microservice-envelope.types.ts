import type { MessagePatternKind, MicroserviceFailure } from "@aponiajs/common";
import type { microserviceEnvelopeVersion } from "./microservice-envelope.constants.ts";

/** The three envelope kinds a broker carries. */
export type MicroserviceEnvelopeKind = MessagePatternKind | "reply";

/** A request asking one service to answer its caller. */
export interface MicroserviceRequestEnvelope {
  /** The wire version. */
  readonly v: typeof microserviceEnvelopeVersion;
  /** The envelope kind. */
  readonly kind: "request";
  /** The client-generated correlation identifier. */
  readonly id: string;
  /** The canonical handler key. */
  readonly pattern: string;
  /** The payload, unchanged by the transport. */
  readonly data: unknown;
  /** The service the message is addressed to. */
  readonly target: string;
  /** The transport-private destination a reply is published to. */
  readonly replyTo: string;
}

/** An event asking one service to observe a message without answering. */
export interface MicroserviceEventEnvelope {
  /** The wire version. */
  readonly v: typeof microserviceEnvelopeVersion;
  /** The envelope kind. */
  readonly kind: "event";
  /** The client-generated correlation identifier. */
  readonly id: string;
  /** The canonical handler key. */
  readonly pattern: string;
  /** The payload, unchanged by the transport. */
  readonly data: unknown;
  /** The service the message is addressed to. */
  readonly target: string;
}

/** A successful answer to one request. */
export interface MicroserviceReplySuccessEnvelope {
  /** The wire version. */
  readonly v: typeof microserviceEnvelopeVersion;
  /** The envelope kind. */
  readonly kind: "reply";
  /** The request identifier this reply answers. */
  readonly id: string;
  /** Marks a successful answer. */
  readonly ok: true;
  /** The handler's value. */
  readonly value: unknown;
}

/** A failed answer to one request. */
export interface MicroserviceReplyFailureEnvelope {
  /** The wire version. */
  readonly v: typeof microserviceEnvelopeVersion;
  /** The envelope kind. */
  readonly kind: "reply";
  /** The request identifier this reply answers. */
  readonly id: string;
  /** Marks a failed answer. */
  readonly ok: false;
  /** The client-safe failure. */
  readonly error: MicroserviceFailure;
}

/** Everything a caller may encode and every shape a broker may decode. */
export type MicroserviceEnvelope =
  | MicroserviceRequestEnvelope
  | MicroserviceEventEnvelope
  | MicroserviceReplySuccessEnvelope
  | MicroserviceReplyFailureEnvelope;

/** The request and event shapes a client encodes. */
export type MicroserviceOutboundEnvelope = MicroserviceRequestEnvelope | MicroserviceEventEnvelope;

/** The two reply shapes a server encodes. */
export type MicroserviceReplyEnvelope =
  | MicroserviceReplySuccessEnvelope
  | MicroserviceReplyFailureEnvelope;
