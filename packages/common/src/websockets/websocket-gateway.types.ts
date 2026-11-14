import type { CanActivate } from "../enhancers/enhancer.types.ts";
import type { ClassToken } from "../tokens/token.types.ts";

/** The `@WebSocketGateway()` declaration as written. */
export interface WebSocketGatewayOptions {
  /** The mount path; defaults to `"/ws"`. */
  readonly path?: string;
  /** Maximum incoming message payload length in bytes. */
  readonly maxPayloadLength?: number;
  /** Handshake guards executed before upgrading the socket connection. */
  readonly guards?: readonly ClassToken<CanActivate>[];
  /**
   * The browser origins allowed to open a socket, when an allowlist is wanted.
   *
   * Each entry is compared to the handshake `Origin` header exactly. A request
   * without an `Origin` header is refused while a list is configured, because
   * the header is what a browser proves its origin with; a non-browser client
   * has to be allowed by the deployment in another way.
   */
  readonly origins?: readonly string[];
  /**
   * Closes a socket that has been silent for this many milliseconds.
   *
   * The native server states this in whole seconds, so a value is rounded up
   * and clamped to at least one second.
   */
  readonly idleTimeoutMs?: number;
  /** Sends the server's own ping frames while a socket is open; defaults off. */
  readonly sendPings?: boolean;
}

/** The lowered gateway metadata: the mount path, payload limits, and upgrade guards. */
export interface WebSocketGatewayMetadata {
  readonly path: string;
  readonly maxPayloadLength?: number | undefined;
  readonly guards?: readonly ClassToken<CanActivate>[] | undefined;
  /** The browser origins the handshake must name, when one is configured. */
  readonly origins?: readonly string[] | undefined;
  /** The idle window in milliseconds, when one is declared. */
  readonly idleTimeoutMs?: number | undefined;
  /** Whether the server sends ping frames. */
  readonly sendPings?: boolean | undefined;
}

/** Schema describing the structure of an incoming WebSocket message. */
export interface WebSocketMessageSchema {
  /** A Standard Schema or platform-native validator describing the incoming message `data`. */
  readonly data?: unknown;
}

/** One message handler `@SubscribeMessage()` declared, in declaration order. */
export interface WebSocketMessageMetadata {
  /** The message event this method answers. */
  readonly event: string;
  /** The handler method carrying this event. */
  readonly propertyKey: string | symbol;
  /** The optional schema validating the message payload. */
  readonly schema?: WebSocketMessageSchema | undefined;
}

/** The message piece a gateway handler parameter binds to. */
export type WebSocketParameterKind = "message-body" | "connected-socket";

/** One compiled gateway handler parameter: its position, its kind, and its named property. */
export interface WebSocketParameterMetadata {
  /** The zero-based parameter position. */
  readonly index: number;
  /** The message piece this parameter reads. */
  readonly kind: WebSocketParameterKind;
  /** The named property to read, or the whole piece when `undefined`. */
  readonly property: string | undefined;
}

/**
 * Selects the event an ordinary handler result is emitted under.
 *
 * A plain result is emitted under the subscribed event; `WsResponse` selects
 * a different one, and `undefined` sends nothing.
 */
export interface WsResponse<TData = unknown> {
  /** The event to emit under. */
  readonly event: string;
  /** The payload the event carries. */
  readonly data: TData;
}

/** Runs once the gateway's server property is injected, before any message arrives. */
export interface OnGatewayInit<TServer = unknown> {
  /**
   * Receives the root application the gateway is mounted on.
   *
   * @param server - The root Elysia application.
   */
  afterInit(server: TServer): void | Promise<void>;
}

/** Runs when a client connects. */
export interface OnGatewayConnection<TClient = unknown> {
  /**
   * Handles one connection.
   *
   * @param client - The native client that connected.
   */
  handleConnection(client: TClient): void | Promise<void>;
}

/** Runs when a client disconnects. */
export interface OnGatewayDisconnect<TClient = unknown> {
  /**
   * Handles one disconnection.
   *
   * @param client - The native client that disconnected.
   */
  handleDisconnect(client: TClient): void | Promise<void>;
}
