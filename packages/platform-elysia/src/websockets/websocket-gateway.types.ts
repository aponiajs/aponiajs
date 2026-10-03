import type { ModuleDefinition, Provider, Token } from "@aponiajs/common";
import type { AnyElysia, Elysia, RouteSchema } from "elysia";
import type { ElysiaWS } from "elysia/ws";

/**
 * The native Elysia client supplied to gateway message and lifecycle handlers.
 */
export type WebSocketClient<TRoute extends RouteSchema = {}> = ElysiaWS<TRoute>;

/**
 * The native Elysia application injected by `@WebSocketServer()`.
 */
export type WebSocketServerRef<TApplication extends AnyElysia = Elysia> = TApplication;

/** One compiled message handler: its event and its per-instance invoker factory. */
export interface CompiledWebSocketHandler {
  /** The message event this handler answers. */
  readonly event: string;
  /** The handler method carrying this event. */
  readonly propertyKey: string | symbol;
  /** Builds the message invoker bound to one gateway instance. */
  readonly createInvoker: (instance: unknown) => WebSocketMessageInvoker;
}

/** One compiled gateway: its owning module, provider, path, handlers, and server properties. */
export interface CompiledWebSocketGateway {
  /** The module declaring the gateway provider. */
  readonly module: ModuleDefinition;
  /** The class provider the gateway instance resolves from. */
  readonly provider: Extract<Provider, { readonly kind: "class" }>;
  /** The token the gateway instance resolves through. */
  readonly token: Token<unknown>;
  /** The gateway class name diagnostics report. */
  readonly gatewayName: string;
  /** The canonical mount path. */
  readonly path: string;
  /** The compiled message handlers, in declaration order. */
  readonly handlers: readonly CompiledWebSocketHandler[];
  /** The properties receiving the root application. */
  readonly serverProperties: readonly (string | symbol)[];
}

/** A bound message invoker: the socket and message a handler answers with. */
export type WebSocketMessageInvoker = (socket: WebSocketClient, data: unknown) => unknown;

/** A gateway bound to the native application: its path and lifecycle entry points. */
export interface BoundWebSocketGateway {
  /** The canonical mount path. */
  readonly path: string;
  /** Registers the native route and injects server properties. */
  readonly initialize: (application: AnyElysia) => void | Promise<void>;
  /** Handles one connection. */
  readonly open: (socket: WebSocketClient) => void | Promise<void>;
  /** Dispatches one incoming message to its handler. */
  readonly message: (socket: WebSocketClient, message: unknown) => Promise<void>;
  /** Handles one disconnection. */
  readonly close: (socket: WebSocketClient) => void | Promise<void>;
}
