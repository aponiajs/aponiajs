import type { CanActivate, ClassToken, WebSocketParameterMetadata } from "@aponiajs/common";

/**
 * One socket as a platform states it.
 *
 * The kernel sends, closes, and publishes through this contract; the host
 * wraps its native socket in it, so a gateway never sees the runtime's type.
 */
export interface GatewaySocket {
  /** Sends one text frame. */
  send(data: string): void;
  /** Closes the socket. */
  close(code?: number, reason?: string): void;
  /** Subscribes the socket to a topic. */
  subscribe(topic: string): void;
  /** Publishes to a topic. */
  publish(topic: string, data: string): void;
}

/** One handler a gateway declares. */
export interface GatewayHandlerPlan {
  /** The event this handler answers. */
  readonly event: string;
  /** The handler method's property key. */
  readonly propertyKey: string | symbol;
  /** The parameters the handler reads. */
  readonly parameters: readonly WebSocketParameterMetadata[];
}

/** One gateway as a platform mounts it. */
export interface GatewayPlan {
  /** The path the gateway answers on. */
  readonly path: string;
  /** The event handlers, in declaration order. */
  readonly handlers: readonly GatewayHandlerPlan[];
  /** The handshake guards, in run order. */
  readonly guards: readonly ClassToken<CanActivate>[];
  /** The payload bound, when declared. */
  readonly maxPayloadLength?: number | undefined;
  /** The origins the handshake must name, when declared. */
  readonly origins?: readonly string[] | undefined;
  /** The idle window, when declared. */
  readonly idleTimeoutMs?: number | undefined;
  /** Whether ping frames are sent. */
  readonly sendPings?: boolean | undefined;
}

/** What a host runs for one mounted gateway. */
export interface GatewayHooks {
  /** Runs once the server is ready. */
  afterInit(): void | Promise<void>;
  /** Runs when a socket connects. */
  open(socket: GatewaySocket): void | Promise<void>;
  /** Runs for every incoming frame. */
  message(socket: GatewaySocket, raw: unknown): void | Promise<void>;
  /** Runs when a socket disconnects. */
  close(socket: GatewaySocket): void | Promise<void>;
}

/** A host that can mount a gateway. */
export interface GatewayHost<TApplication> {
  /** A host without WebSocket support states no `mountGateway`. */
  mountGateway(application: TApplication, plan: GatewayPlan, hooks: GatewayHooks): void;
}
