import type { ClassToken, Constructor, Token, TokenValues } from "@aponiajs/common";
import type {
  DeclaredElysiaWebSocketGateway,
  ElysiaWebSocketGatewayOptions,
  ElysiaWebSocketGatewayPlan,
  ElysiaWebSocketHandlerPlan,
} from "./gateway-plan.types.ts";

/**
 * Defines a WebSocket gateway whose path, message handlers, and server
 * properties are declared as data.
 *
 * This is the descriptor path's counterpart to decorating a class with
 * `@WebSocketGateway()`, `@SubscribeMessage()`, `@MessageBody()`,
 * `@ConnectedSocket()`, and `@WebSocketServer()`, and it is what build-time
 * descriptor generation emits: the application keeps its decorators as the
 * authoring surface, while the generated module supplies the same gateway
 * without anyone reading `reflect-metadata` at startup.
 *
 * The result is an ordinary class provider, so the gateway is registered in
 * `@Module({ providers })` exactly as a decorated one is, resolved through the
 * same token, and mounted by the same bootstrap step: a declared gateway is
 * discovered by the plan it carries instead of by its decorators, and every
 * rejection — a duplicate path, a duplicate event, a handler that is not
 * callable — is raised by that same step, at the same moment, with the same
 * code a decorated gateway gets.
 */
export function defineElysiaWebSocketGateway<
  TGateway,
  const TDependencies extends readonly Token<unknown>[] = readonly [],
>(
  useClass: ClassToken<TGateway> & Constructor<TGateway, TokenValues<TDependencies>>,
  options: ElysiaWebSocketGatewayOptions<TDependencies> = {},
): DeclaredElysiaWebSocketGateway<TGateway, TDependencies> {
  return Object.freeze({
    kind: "class",
    provide: useClass as Token<TGateway>,
    inject: Object.freeze([...(options.inject ?? [])]) as unknown as TDependencies,
    useClass,
    gateway: freezeGatewayPlan(options),
  });
}

/**
 * Copies the caller's plan into the frozen one the provider carries.
 *
 * The collections are copied rather than referenced so a provider's plan cannot
 * change after it was declared, which is the same guarantee the decorator path
 * gets from metadata written once at class definition.
 */
function freezeGatewayPlan(
  options: ElysiaWebSocketGatewayOptions<readonly Token<unknown>[]>,
): ElysiaWebSocketGatewayPlan {
  return Object.freeze({
    ...(options.path === undefined ? {} : { path: options.path }),
    handlers: Object.freeze((options.handlers ?? []).map(freezeHandler)),
    serverProperties: Object.freeze([...(options.serverProperties ?? [])]),
  });
}

function freezeHandler(handler: ElysiaWebSocketHandlerPlan): ElysiaWebSocketHandlerPlan {
  return Object.freeze({
    event: handler.event,
    propertyKey: handler.propertyKey,
    ...(handler.parameters === undefined
      ? {}
      : { parameters: Object.freeze([...handler.parameters]) }),
  });
}
