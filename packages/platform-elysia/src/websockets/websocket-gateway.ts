import {
  AponiaError,
  getWebSocketGatewayMetadata,
  getWebSocketMessageMetadata,
  getWebSocketParameterMetadata,
  getWebSocketServerProperties,
  tokenName,
  type AponiaErrorCode,
  type ClassToken,
  type ModuleDefinition,
  type WebSocketParameterMetadata,
  type WsResponse,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import type { AnyElysia } from "elysia";
import type {
  BoundElysiaWebSocketGateway,
  CompiledElysiaWebSocketGateway,
  CompiledElysiaWebSocketHandler,
  ElysiaWebSocket,
  ElysiaWebSocketMessageInvoker,
} from "./websocket-gateway.types.ts";

type WebSocketExceptionCode = Extract<
  AponiaErrorCode,
  "INVALID_WEBSOCKET_MESSAGE" | "UNKNOWN_WEBSOCKET_EVENT" | "WEBSOCKET_HANDLER_ERROR"
>;

type MessageHandler = (...arguments_: unknown[]) => unknown;
type MessageInvokerFactory = (
  handler: MessageHandler,
  instance: unknown,
) => ElysiaWebSocketMessageInvoker;
type GatewayLifecycleMethod = (argument: unknown) => unknown;

interface IncomingWebSocketMessage {
  readonly event: string;
  readonly data: unknown;
}

/**
 * Discovers and lowers decorated class providers into immutable gateway plans.
 *
 * @internal
 */
export function compileElysiaWebSocketGateways(
  modules: readonly ModuleDefinition[],
): readonly CompiledElysiaWebSocketGateway[] {
  const gateways: CompiledElysiaWebSocketGateway[] = [];
  const paths = new Map<string, CompiledElysiaWebSocketGateway>();

  for (const module of modules) {
    for (const provider of module.providers) {
      if (provider.kind !== "class") {
        continue;
      }

      const gatewayClass = provider.useClass as ClassToken<unknown>;
      const metadata = getWebSocketGatewayMetadata(gatewayClass);
      if (!metadata) {
        continue;
      }

      const gateway = compileGateway(module, provider, gatewayClass, metadata.path);
      const existing = paths.get(gateway.path);
      if (existing) {
        throw new AponiaError(
          "DUPLICATE_WEBSOCKET_GATEWAY",
          `WebSocket gateway path "${gateway.path}" is registered more than once.`,
          {
            path: gateway.path,
            modules: Object.freeze([existing.module.id, gateway.module.id]),
            gateways: Object.freeze([existing.gatewayName, gateway.gatewayName]),
          },
        );
      }

      paths.set(gateway.path, gateway);
      gateways.push(gateway);
    }
  }

  return Object.freeze(gateways);
}

/**
 * Resolves gateway provider instances, validates them, and mounts one native
 * Elysia WebSocket route per compiled gateway.
 *
 * @internal
 */
export async function registerElysiaWebSocketGateways(
  application: AnyElysia,
  container: AponiaContainer,
  gateways: readonly CompiledElysiaWebSocketGateway[],
): Promise<void> {
  const boundGateways = gateways.map((gateway) => {
    const instance = container.resolveModuleProvider(gateway.module, gateway.token);
    return bindElysiaWebSocketGateway(gateway, instance);
  });
  assertNoNativeWebSocketRouteCollisions(application, gateways);

  for (const gateway of boundGateways) {
    application.ws(gateway.path, {
      open: (socket: ElysiaWebSocket) => gateway.open(socket),
      message: (socket: ElysiaWebSocket, message: unknown) => gateway.message(socket, message),
      close: (socket: ElysiaWebSocket) => gateway.close(socket),
    });
  }

  for (const gateway of boundGateways) {
    await gateway.initialize(application);
  }
}

/**
 * Binds one compiled plan to the instance owned by the DI container.
 *
 * @internal
 */
export function bindElysiaWebSocketGateway(
  gateway: CompiledElysiaWebSocketGateway,
  instance: unknown,
): BoundElysiaWebSocketGateway {
  if (!isObject(instance)) {
    throw invalidGateway(gateway, "The gateway provider did not resolve to an object.");
  }

  const handlers = new Map(
    gateway.handlers.map((handler) => [handler.event, handler.createInvoker(instance)]),
  );
  const afterInit = resolveLifecycleMethod(gateway, instance, "afterInit");
  const handleConnection = resolveLifecycleMethod(gateway, instance, "handleConnection");
  const handleDisconnect = resolveLifecycleMethod(gateway, instance, "handleDisconnect");

  return Object.freeze({
    path: gateway.path,
    initialize: (application: AnyElysia) => {
      injectWebSocketServer(gateway, instance, application);
      return invokeLifecycle(afterInit, instance, application);
    },
    open: (socket: ElysiaWebSocket) => invokeSocketLifecycle(handleConnection, instance, socket),
    message: (socket: ElysiaWebSocket, message: unknown) =>
      dispatchWebSocketMessage(socket, message, handlers),
    close: (socket: ElysiaWebSocket) => invokeSocketLifecycle(handleDisconnect, instance, socket),
  });
}

function compileGateway(
  module: ModuleDefinition,
  provider: Extract<ModuleDefinition["providers"][number], { readonly kind: "class" }>,
  gatewayClass: ClassToken<unknown>,
  path: string,
): CompiledElysiaWebSocketGateway {
  const gatewayName = gatewayClass.name;
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new AponiaError(
      "INVALID_WEBSOCKET_GATEWAY",
      `WebSocket gateway "${gatewayName}" has an invalid path.`,
      { module: module.id, gateway: gatewayName },
    );
  }
  const normalizedPath = normalizeGatewayPath(path);

  const handlers: CompiledElysiaWebSocketHandler[] = [];
  const events = new Map<string, string | symbol>();
  for (const message of getWebSocketMessageMetadata(gatewayClass)) {
    const existing = events.get(message.event);
    if (existing !== undefined) {
      throw new AponiaError(
        "DUPLICATE_WEBSOCKET_HANDLER",
        `WebSocket gateway "${gatewayName}" has more than one handler for event "${message.event}".`,
        {
          module: module.id,
          gateway: gatewayName,
          event: message.event,
          handlers: Object.freeze([String(existing), String(message.propertyKey)]),
        },
      );
    }

    const prototypeHandler = Reflect.get(gatewayClass.prototype, message.propertyKey) as unknown;
    if (typeof prototypeHandler !== "function") {
      throw invalidGatewayDefinition(
        module,
        gatewayName,
        message.propertyKey,
        "The decorated message handler is not callable.",
      );
    }

    const parameters = getWebSocketParameterMetadata(gatewayClass, message.propertyKey);
    assertDistinctParameterIndexes(module, gatewayName, message.propertyKey, parameters);
    const invokerFactory = compileMessageInvoker(parameters);
    handlers.push(
      Object.freeze({
        event: message.event,
        propertyKey: message.propertyKey,
        createInvoker: (instance: unknown) => {
          const handler = isObject(instance)
            ? Reflect.get(instance, message.propertyKey)
            : undefined;
          if (typeof handler !== "function") {
            throw invalidGatewayDefinition(
              module,
              gatewayName,
              message.propertyKey,
              "The resolved message handler is not callable.",
            );
          }
          return invokerFactory(handler as MessageHandler, instance);
        },
      }),
    );
    events.set(message.event, message.propertyKey);
  }

  return Object.freeze({
    module,
    provider,
    token: provider.provide,
    gatewayName,
    path: normalizedPath,
    handlers: Object.freeze(handlers),
    serverProperties: Object.freeze([...getWebSocketServerProperties(gatewayClass)]),
  });
}

function assertDistinctParameterIndexes(
  module: ModuleDefinition,
  gatewayName: string,
  propertyKey: string | symbol,
  parameters: readonly WebSocketParameterMetadata[],
): void {
  const indexes = new Set<number>();
  for (const parameter of parameters) {
    if (indexes.has(parameter.index)) {
      throw invalidGatewayDefinition(
        module,
        gatewayName,
        propertyKey,
        `Message handler parameter ${parameter.index} has more than one WebSocket decorator.`,
      );
    }
    indexes.add(parameter.index);
  }
}

function compileMessageInvoker(
  parameters: readonly WebSocketParameterMetadata[],
): MessageInvokerFactory {
  if (parameters.length === 0) {
    return createMessageInvokerFactory("");
  }

  const arguments_ = Array.from({ length: parameters.at(-1)!.index + 1 }, () => "undefined");
  for (const parameter of parameters) {
    arguments_[parameter.index] = parameterExpression(parameter);
  }
  return createMessageInvokerFactory(arguments_.join(","));
}

const messageInvokerFactories = new Map<string, MessageInvokerFactory>();

function createMessageInvokerFactory(argumentsSource: string): MessageInvokerFactory {
  const cached = messageInvokerFactories.get(argumentsSource);
  if (cached) {
    return cached;
  }

  const invocation = `handler.call(instance${argumentsSource ? `,${argumentsSource}` : ""})`;
  // Property names are JSON-encoded before interpolation. The handler and
  // instance remain closed values, matching Elysia's own compiled hot path.
  // oxlint-disable-next-line typescript/no-implied-eval
  const factory = Function(
    "handler",
    "instance",
    `"use strict";return(socket,data)=>${invocation}`,
  ) as MessageInvokerFactory;
  messageInvokerFactories.set(argumentsSource, factory);
  return factory;
}

function parameterExpression(parameter: WebSocketParameterMetadata): string {
  if (parameter.kind === "connected-socket") {
    return "socket";
  }
  if (parameter.property === undefined) {
    return "data";
  }

  const property = JSON.stringify(parameter.property);
  return `(typeof data==="object"&&data!==null?data[${property}]:undefined)`;
}

async function dispatchWebSocketMessage(
  socket: ElysiaWebSocket,
  message: unknown,
  handlers: ReadonlyMap<string, ElysiaWebSocketMessageInvoker>,
): Promise<void> {
  const incoming = parseIncomingMessage(message);
  if (!incoming) {
    sendException(
      socket,
      "INVALID_WEBSOCKET_MESSAGE",
      "WebSocket messages must contain a non-empty string event.",
    );
    return;
  }

  const handler = handlers.get(incoming.event);
  if (!handler) {
    sendException(
      socket,
      "UNKNOWN_WEBSOCKET_EVENT",
      "No WebSocket handler is registered for this event.",
    );
    return;
  }

  try {
    const result = await handler(socket, incoming.data);
    await emitHandlerResult(socket, incoming.event, result);
  } catch {
    sendException(socket, "WEBSOCKET_HANDLER_ERROR", "The WebSocket handler failed.");
  }
}

async function emitHandlerResult(
  socket: ElysiaWebSocket,
  subscribedEvent: string,
  result: unknown,
): Promise<void> {
  if (isAsyncIterator(result)) {
    for await (const value of result) {
      await emitHandlerValue(socket, subscribedEvent, value);
    }
    return;
  }

  if (isSyncIterator(result)) {
    for (const value of result) {
      await emitHandlerValue(socket, subscribedEvent, value);
    }
    return;
  }

  await emitHandlerValue(socket, subscribedEvent, result);
}

async function emitHandlerValue(
  socket: ElysiaWebSocket,
  subscribedEvent: string,
  value: unknown,
): Promise<void> {
  const resolved = await value;
  if (resolved === undefined) {
    return;
  }

  const response = isWsResponse(resolved)
    ? Object.freeze({ event: resolved.event, data: resolved.data })
    : Object.freeze({ event: subscribedEvent, data: resolved });
  socket.send(response);
}

function parseIncomingMessage(message: unknown): IncomingWebSocketMessage | undefined {
  let candidate = message;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!isObject(candidate)) {
    return undefined;
  }

  try {
    const event = Reflect.get(candidate, "event") as unknown;
    if (typeof event !== "string" || event.trim().length === 0) {
      return undefined;
    }
    return { event, data: Reflect.get(candidate, "data") as unknown };
  } catch {
    return undefined;
  }
}

function isWsResponse(value: unknown): value is WsResponse {
  if (!isObject(value) || !Object.hasOwn(value, "data")) {
    return false;
  }

  const event = Reflect.get(value, "event") as unknown;
  return typeof event === "string" && event.trim().length > 0;
}

function isAsyncIterator(value: unknown): value is AsyncIterableIterator<unknown> {
  return (
    isObject(value) &&
    typeof Reflect.get(value, "next") === "function" &&
    typeof Reflect.get(value, Symbol.asyncIterator) === "function"
  );
}

function isSyncIterator(value: unknown): value is IterableIterator<unknown> {
  return (
    isObject(value) &&
    typeof Reflect.get(value, "next") === "function" &&
    typeof Reflect.get(value, Symbol.iterator) === "function"
  );
}

function sendException(
  socket: ElysiaWebSocket,
  code: WebSocketExceptionCode,
  message: string,
): void {
  socket.send(
    Object.freeze({
      event: "exception",
      data: Object.freeze({ code, message }),
    }),
  );
}

function injectWebSocketServer(
  gateway: CompiledElysiaWebSocketGateway,
  instance: object,
  application: AnyElysia,
): void {
  for (const property of gateway.serverProperties) {
    let assigned = false;
    try {
      assigned = Reflect.set(instance, property, application, instance);
    } catch {
      throw invalidGateway(
        gateway,
        `WebSocket server property "${String(property)}" could not be assigned.`,
      );
    }
    if (!assigned) {
      throw invalidGateway(
        gateway,
        `WebSocket server property "${String(property)}" could not be assigned.`,
      );
    }
  }
}

function resolveLifecycleMethod(
  gateway: CompiledElysiaWebSocketGateway,
  instance: object,
  property: "afterInit" | "handleConnection" | "handleDisconnect",
): GatewayLifecycleMethod | undefined {
  const method = Reflect.get(instance, property) as unknown;
  if (method === undefined) {
    return undefined;
  }
  if (typeof method !== "function") {
    throw invalidGateway(gateway, `Gateway lifecycle member "${property}" is not callable.`);
  }
  return method as GatewayLifecycleMethod;
}

function invokeLifecycle(
  method: GatewayLifecycleMethod | undefined,
  instance: object,
  argument: unknown,
): void | Promise<void> {
  if (!method) {
    return;
  }

  const result = Reflect.apply(method, instance, [argument]) as unknown;
  if (!isPromiseLike(result)) {
    return;
  }
  return Promise.resolve(result).then(() => undefined);
}

function invokeSocketLifecycle(
  method: GatewayLifecycleMethod | undefined,
  instance: object,
  socket: ElysiaWebSocket,
): void | Promise<void> {
  try {
    const result = invokeLifecycle(method, instance, socket);
    if (!result) {
      return;
    }
    return result.catch(() => {
      sendException(socket, "WEBSOCKET_HANDLER_ERROR", "The WebSocket lifecycle handler failed.");
    });
  } catch {
    sendException(socket, "WEBSOCKET_HANDLER_ERROR", "The WebSocket lifecycle handler failed.");
  }
}

function assertNoNativeWebSocketRouteCollisions(
  application: AnyElysia,
  gateways: readonly CompiledElysiaWebSocketGateway[],
): void {
  const nativePaths = new Set(
    application.routes
      .filter((route) => String(route.method).toUpperCase() === "WS")
      .map((route) => normalizeGatewayPath(route.path)),
  );

  for (const gateway of gateways) {
    if (!nativePaths.has(gateway.path)) {
      continue;
    }
    throw new AponiaError(
      "DUPLICATE_WEBSOCKET_GATEWAY",
      `WebSocket gateway path "${gateway.path}" conflicts with a native Elysia route.`,
      {
        path: gateway.path,
        module: gateway.module.id,
        gateway: gateway.gatewayName,
        source: "native",
      },
    );
  }
}

function normalizeGatewayPath(path: string): string {
  const segment = path.trim().replace(/^\/+|\/+$/g, "");
  return segment.length === 0 ? "/" : `/${segment}`;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof Reflect.get(value, "then") === "function"
  );
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function invalidGateway(gateway: CompiledElysiaWebSocketGateway, message: string): AponiaError {
  return new AponiaError("INVALID_WEBSOCKET_GATEWAY", message, {
    module: gateway.module.id,
    gateway: gateway.gatewayName,
    token: tokenName(gateway.token),
  });
}

function invalidGatewayDefinition(
  module: ModuleDefinition,
  gatewayName: string,
  propertyKey: string | symbol,
  message: string,
): AponiaError {
  return new AponiaError("INVALID_WEBSOCKET_GATEWAY", message, {
    module: module.id,
    gateway: gatewayName,
    handler: String(propertyKey),
  });
}
