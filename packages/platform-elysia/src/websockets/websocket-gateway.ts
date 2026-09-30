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
import type { ElysiaWebSocketGatewayPlan } from "./gateway-plan.types.ts";
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
 * The path a gateway that declares none is mounted at. Mirrors the default in
 * `@aponiajs/common`'s `normalizeGatewayPath`.
 */
const defaultGatewayPath = "/ws";

/**
 * The property a declared gateway provider carries its plan on, which is the
 * field `defineElysiaWebSocketGateway` writes.
 */
const declaredGatewayPlanKey = "gateway";

/** One message handler, before it is compiled into an invoker factory. */
interface GatewayHandlerPlan {
  readonly event: string;
  readonly propertyKey: string | symbol;
  readonly parameters: readonly WebSocketParameterMetadata[];
}

/** Everything a gateway declares, however it was authored. */
interface GatewayPlan {
  readonly path: string;
  readonly handlers: readonly GatewayHandlerPlan[];
  readonly serverProperties: readonly (string | symbol)[];
}

/**
 * Discovers class providers into immutable gateway plans.
 *
 * Both authoring paths are discovered here. A provider carrying a `gateway`
 * plan is a declared one, and nothing is read from its class; a provider
 * without one is the decorator path, which reads `@WebSocketGateway()`,
 * `@SubscribeMessage()`, and the member decorators off `useClass`. The two
 * produce the same plan and are compiled by the same call, so a gateway that
 * declares a duplicate path or a duplicate event is rejected with the same code
 * at the same point whichever way it was authored.
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
      const plan = readGatewayPlan(module, provider, gatewayClass);
      if (plan === undefined) {
        continue;
      }

      const gateway = compileGateway(module, provider, gatewayClass, plan);
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

  // `ws` infers its socket context from the hook it is handed, the same way
  // `method` infers a route's schema from one. These handlers are written
  // against `ElysiaWebSocket` instead, so the call states the signature it
  // needs. This module is the only place the platform registers a WebSocket
  // route, which is where that cast belongs.
  const nativeApplication = application as unknown as {
    readonly ws: (
      path: string,
      hook: {
        open(socket: ElysiaWebSocket): unknown;
        message(socket: ElysiaWebSocket, message: unknown): unknown;
        close(socket: ElysiaWebSocket): unknown;
      },
    ) => unknown;
  };

  for (const gateway of boundGateways) {
    nativeApplication.ws(gateway.path, {
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

/**
 * The plan a class provider declares, or `undefined` when the provider is not a
 * gateway at all.
 *
 * A provider carrying a `gateway` plan is a declared one, and nothing is read
 * from its class. Every other class provider takes the decorator path, which is
 * the one that existed before declared gateways did.
 */
function readGatewayPlan(
  module: ModuleDefinition,
  provider: Extract<ModuleDefinition["providers"][number], { readonly kind: "class" }>,
  gatewayClass: ClassToken<unknown>,
): GatewayPlan | undefined {
  const declared = Reflect.get(provider, declaredGatewayPlanKey) as
    | ElysiaWebSocketGatewayPlan
    | undefined;
  if (declared !== undefined) {
    return readDeclaredGatewayPlan(module, gatewayClass, declared);
  }

  const metadata = getWebSocketGatewayMetadata(gatewayClass);
  if (!metadata) {
    return undefined;
  }

  return {
    path: metadata.path,
    handlers: getWebSocketMessageMetadata(gatewayClass).map((message) =>
      Object.freeze({
        event: message.event,
        propertyKey: message.propertyKey,
        parameters: getWebSocketParameterMetadata(gatewayClass, message.propertyKey),
      }),
    ),
    serverProperties: getWebSocketServerProperties(gatewayClass),
  };
}

/**
 * Reads the plan a declared gateway provider carries.
 *
 * The shape is validated rather than trusted, because a hand-written provider
 * literal is the escape hatch this path exists to support: a plan that is not an
 * object, or whose handlers or server properties are not arrays, would otherwise
 * mount a gateway that silently ignores what it declares.
 */
function readDeclaredGatewayPlan(
  module: ModuleDefinition,
  gatewayClass: ClassToken<unknown>,
  plan: unknown,
): GatewayPlan {
  const gatewayName = gatewayClass.name;
  if (!isObject(plan)) {
    throw invalidGatewayDeclaration(
      module,
      gatewayName,
      "declares a gateway plan that is not an object.",
    );
  }

  const handlers = Reflect.get(plan, "handlers") ?? [];
  if (!Array.isArray(handlers)) {
    throw invalidGatewayDeclaration(module, gatewayName, 'must declare "handlers" as an array.');
  }

  const serverProperties = Reflect.get(plan, "serverProperties") ?? [];
  if (!Array.isArray(serverProperties)) {
    throw invalidGatewayDeclaration(
      module,
      gatewayName,
      'must declare "serverProperties" as an array.',
    );
  }

  const path = Reflect.get(plan, "path");
  if (path !== undefined && typeof path !== "string") {
    throw invalidGatewayDeclaration(module, gatewayName, "must declare its path as a string.");
  }

  return {
    path: path ?? defaultGatewayPath,
    handlers: Object.freeze(
      handlers.map((handler) => readDeclaredGatewayHandler(module, gatewayName, handler)),
    ),
    serverProperties: Object.freeze([...(serverProperties as readonly (string | symbol)[])]),
  };
}

/**
 * Reads one declared handler.
 *
 * The event is the handler's whole identity — it is the key a message is routed
 * by — so a plan that declares an empty one, or none at all, is refused rather
 * than mounted as a handler no client can reach.
 */
function readDeclaredGatewayHandler(
  module: ModuleDefinition,
  gatewayName: string,
  handler: unknown,
): GatewayHandlerPlan {
  if (!isObject(handler)) {
    throw invalidGatewayDeclaration(
      module,
      gatewayName,
      "declares a handler that is not an object.",
    );
  }

  const event = Reflect.get(handler, "event");
  const propertyKey = Reflect.get(handler, "propertyKey");
  const parameters = Reflect.get(handler, "parameters") ?? [];
  if (typeof event !== "string" || event.trim().length === 0) {
    throw invalidGatewayDeclaration(
      module,
      gatewayName,
      "declares a handler whose event is not a non-empty string.",
    );
  }
  if (typeof propertyKey !== "string" && typeof propertyKey !== "symbol") {
    throw invalidGatewayDeclaration(
      module,
      gatewayName,
      "declares a handler without a property key.",
    );
  }
  if (!Array.isArray(parameters)) {
    throw invalidGatewayDeclaration(
      module,
      gatewayName,
      "declares a handler whose parameters are not an array.",
    );
  }

  return Object.freeze({
    event,
    propertyKey,
    parameters: parameters as readonly WebSocketParameterMetadata[],
  });
}

function compileGateway(
  module: ModuleDefinition,
  provider: Extract<ModuleDefinition["providers"][number], { readonly kind: "class" }>,
  gatewayClass: ClassToken<unknown>,
  plan: GatewayPlan,
): CompiledElysiaWebSocketGateway {
  const gatewayName = gatewayClass.name;
  const path = plan.path;
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
  for (const declared of plan.handlers) {
    const existing = events.get(declared.event);
    if (existing !== undefined) {
      throw new AponiaError(
        "DUPLICATE_WEBSOCKET_HANDLER",
        `WebSocket gateway "${gatewayName}" has more than one handler for event "${declared.event}".`,
        {
          module: module.id,
          gateway: gatewayName,
          event: declared.event,
          handlers: Object.freeze([String(existing), String(declared.propertyKey)]),
        },
      );
    }

    const prototypeHandler = Reflect.get(gatewayClass.prototype, declared.propertyKey) as unknown;
    if (typeof prototypeHandler !== "function") {
      throw invalidGatewayDefinition(
        module,
        gatewayName,
        declared.propertyKey,
        "The message handler is not callable.",
      );
    }

    const parameters = declared.parameters;
    assertDistinctParameterIndexes(module, gatewayName, declared.propertyKey, parameters);
    const invokerFactory = compileMessageInvoker(parameters);
    handlers.push(
      Object.freeze({
        event: declared.event,
        propertyKey: declared.propertyKey,
        createInvoker: (instance: unknown) => {
          const handler = isObject(instance)
            ? Reflect.get(instance, declared.propertyKey)
            : undefined;
          if (typeof handler !== "function") {
            throw invalidGatewayDefinition(
              module,
              gatewayName,
              declared.propertyKey,
              "The resolved message handler is not callable.",
            );
          }
          return invokerFactory(handler as MessageHandler, instance);
        },
      }),
    );
    events.set(declared.event, declared.propertyKey);
  }

  return Object.freeze({
    module,
    provider,
    token: provider.provide,
    gatewayName,
    path: normalizedPath,
    handlers: Object.freeze(handlers),
    serverProperties: Object.freeze([...plan.serverProperties]),
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

function invalidGatewayDeclaration(
  module: ModuleDefinition,
  gatewayName: string,
  message: string,
): AponiaError {
  return new AponiaError(
    "INVALID_WEBSOCKET_GATEWAY",
    `WebSocket gateway "${gatewayName}" ${message}`,
    {
      module: module.id,
      gateway: gatewayName,
    },
  );
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
