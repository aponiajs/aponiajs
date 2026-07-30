import type { ModuleDefinition, Provider, Token } from "@aponiajs/common";
import type { AnyElysia, Elysia, RouteSchema } from "elysia";
import type { ElysiaWS } from "elysia/ws";

/**
 * The native Elysia client supplied to gateway message and lifecycle handlers.
 */
export type ElysiaWebSocket<TContext = unknown, TRoute extends RouteSchema = {}> = ElysiaWS<
  TContext,
  TRoute
>;

/**
 * The native Elysia application injected by `@WebSocketServer()`.
 */
export type ElysiaWebSocketServer<TApplication extends AnyElysia = Elysia> = TApplication;

export interface CompiledElysiaWebSocketHandler {
  readonly event: string;
  readonly propertyKey: string | symbol;
  readonly createInvoker: (instance: unknown) => ElysiaWebSocketMessageInvoker;
}

export interface CompiledElysiaWebSocketGateway {
  readonly module: ModuleDefinition;
  readonly provider: Extract<Provider, { readonly kind: "class" }>;
  readonly token: Token<unknown>;
  readonly gatewayName: string;
  readonly path: string;
  readonly handlers: readonly CompiledElysiaWebSocketHandler[];
  readonly serverProperties: readonly (string | symbol)[];
}

export type ElysiaWebSocketMessageInvoker = (socket: ElysiaWebSocket, data: unknown) => unknown;

export interface BoundElysiaWebSocketGateway {
  readonly path: string;
  readonly initialize: (application: AnyElysia) => void | Promise<void>;
  readonly open: (socket: ElysiaWebSocket) => void | Promise<void>;
  readonly message: (socket: ElysiaWebSocket, message: unknown) => Promise<void>;
  readonly close: (socket: ElysiaWebSocket) => void | Promise<void>;
}
