import type { ClassProvider, Token, WebSocketParameterMetadata } from "@aponiajs/common";

/**
 * One message handler a gateway declares, as data rather than as decorator
 * metadata.
 *
 * This is the descriptor path's equivalent of `@SubscribeMessage(event)` on a
 * gateway method plus the `@MessageBody()` and `@ConnectedSocket()` decorators
 * on its parameters.
 */
export interface ElysiaWebSocketHandlerPlan {
  /** The event the handler subscribes to, exactly as `@SubscribeMessage(event)` declares it. */
  readonly event: string;
  /** The handler's property key, which is how the instance is looked up when a message arrives. */
  readonly propertyKey: string | symbol;
  /**
   * The handler's parameter bindings, in declaration order.
   *
   * Only parameters a WebSocket decorator binds appear. Omitting the field, or
   * passing an empty list, binds no argument — which is what a handler with no
   * such decorator receives from the decorator path.
   */
  readonly parameters?: readonly WebSocketParameterMetadata[];
}

/**
 * A WebSocket gateway declared as data, the descriptor path's counterpart to
 * `@WebSocketGateway()` and its member decorators.
 *
 * `defineElysiaWebSocketGateway` is the factory that turns one of these into
 * the provider a module declares, and it is what build-time descriptor
 * generation emits. A plan never registers itself: `websockets/websocket-gateway.ts`
 * stays the only module that calls `application.ws()`.
 *
 * The values `@WebSocketGateway()`, `@SubscribeMessage()`, and
 * `@WebSocketServer()` record as metadata are stated here instead, because a
 * plan has no class to reflect on. Everything else is not stated, and does not
 * need to be: connection and disconnection lifecycle is resolved from the
 * instance while a gateway is bound, and message results, exception frames, and
 * unknown-event handling are owned by the platform's dispatch.
 */
export interface ElysiaWebSocketGatewayPlan {
  /**
   * The gateway's path. Omitting it means `/ws`, exactly as an argument-less
   * `@WebSocketGateway()` does.
   */
  readonly path?: string;
  /** The gateway's message handlers, in declaration order. */
  readonly handlers?: readonly ElysiaWebSocketHandlerPlan[];
  /**
   * The instance properties that receive the root application, as
   * `@WebSocketServer()` marks them.
   */
  readonly serverProperties?: readonly (string | symbol)[];
}

/** The options `defineElysiaWebSocketGateway` accepts. */
export interface ElysiaWebSocketGatewayOptions<
  TDependencies extends readonly Token<unknown>[] = readonly [],
> {
  /** The tokens the container resolves the gateway's constructor with. */
  readonly inject?: TDependencies;
  /** The gateway's path, or `undefined` for `/ws`. */
  readonly path?: string;
  /** The gateway's message handlers, in declaration order. */
  readonly handlers?: readonly ElysiaWebSocketHandlerPlan[];
  /** The instance properties that receive the root application. */
  readonly serverProperties?: readonly (string | symbol)[];
}

/**
 * The class provider a declared gateway is.
 *
 * It is an ordinary `ClassProvider`, so the container builds it exactly as it
 * builds a decorated gateway: `kind`, `provide`, `inject`, and `useClass` are
 * the same four fields `provideClass` writes, and the token is the class itself.
 * The `gateway` property is what makes it declared — bootstrap compiles the plan
 * it carries instead of reading `@WebSocketGateway()` and `@SubscribeMessage()`
 * off `useClass`.
 */
export interface DeclaredElysiaWebSocketGateway<
  T,
  TDependencies extends readonly Token<unknown>[] = readonly [],
> extends ClassProvider<T, TDependencies> {
  /** The gateway this provider declares. */
  readonly gateway: ElysiaWebSocketGatewayPlan;
}
