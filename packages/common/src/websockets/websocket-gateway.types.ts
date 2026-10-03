/** The `@WebSocketGateway()` declaration as written. */
export interface WebSocketGatewayOptions {
  /** The mount path; defaults to `"/ws"`. */
  readonly path?: string;
}

/** The lowered gateway metadata: the mount path, always present. */
export interface WebSocketGatewayMetadata {
  readonly path: string;
}

/** One message handler `@SubscribeMessage()` declared, in declaration order. */
export interface WebSocketMessageMetadata {
  /** The message event this method answers. */
  readonly event: string;
  /** The handler method carrying this event. */
  readonly propertyKey: string | symbol;
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
