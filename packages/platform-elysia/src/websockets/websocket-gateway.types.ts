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

export interface CompiledWebSocketHandler {
  readonly event: string;
  readonly propertyKey: string | symbol;
  readonly createInvoker: (instance: unknown) => WebSocketMessageInvoker;
}

export interface CompiledWebSocketGateway {
  readonly module: ModuleDefinition;
  readonly provider: Extract<Provider, { readonly kind: "class" }>;
  readonly token: Token<unknown>;
  readonly gatewayName: string;
  readonly path: string;
  readonly handlers: readonly CompiledWebSocketHandler[];
  readonly serverProperties: readonly (string | symbol)[];
}

export type WebSocketMessageInvoker = (socket: WebSocketClient, data: unknown) => unknown;

export interface BoundWebSocketGateway {
  readonly path: string;
  readonly initialize: (application: AnyElysia) => void | Promise<void>;
  readonly open: (socket: WebSocketClient) => void | Promise<void>;
  readonly message: (socket: WebSocketClient, message: unknown) => Promise<void>;
  readonly close: (socket: WebSocketClient) => void | Promise<void>;
}
