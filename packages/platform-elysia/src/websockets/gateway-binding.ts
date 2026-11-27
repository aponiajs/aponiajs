import {
  AponiaError,
  getTokenName,
  type CanActivate,
  type ClassToken,
  type ExecutionContext,
  type HttpArgumentsHost,
  type ModuleDefinition,
  type RouteContext,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import { httpErrors } from "@aponiajs/common";
import type { AnyElysia } from "elysia";
import type { ResolvedFilter } from "../controllers/enhancer.resolver.ts";
import {
  dispatchWebSocketMessage,
  isObject,
  isPromiseLike,
  sendException,
} from "./gateway-dispatch.ts";
import type {
  BoundWebSocketGateway,
  CompiledWebSocketGateway,
  WebSocketClient,
} from "../interfaces/websocket-gateway.interface.ts";

type GatewayLifecycleMethod = (argument: unknown) => unknown;

/**
 * Binds one compiled plan to the instance owned by the DI container.
 *
 * @internal
 */
export function bindWebSocketGateway(
  gateway: CompiledWebSocketGateway,
  instance: unknown,
  guards: readonly CanActivate[] = [],
  filters: readonly ResolvedFilter[] = [],
): BoundWebSocketGateway {
  if (!isObject(instance)) {
    throw invalidGateway(gateway, "The gateway provider did not resolve to an object.");
  }

  const handlers = new Map(
    gateway.handlers.map((handler) => [handler.event, handler.createInvoker(instance)]),
  );
  const afterInit = resolveLifecycleMethod(gateway, instance, "afterInit");
  const handleConnection = resolveLifecycleMethod(gateway, instance, "handleConnection");
  const handleDisconnect = resolveLifecycleMethod(gateway, instance, "handleDisconnect");

  const origins = gateway.origins;
  const beforeHandle =
    origins !== undefined || guards.length > 0
      ? async (context: { readonly request: Request }) => {
          if (origins !== undefined) {
            const origin = context.request.headers.get("origin");
            if (origin === null || !origins.includes(origin)) {
              throw httpErrors.forbidden("The WebSocket origin is not allowed.");
            }
          }
          const executionContext = createGatewayExecutionContext(gateway, instance, context);
          for (const guard of guards) {
            const allowed = await guard.canActivate(executionContext);
            if (allowed === false) {
              throw httpErrors.forbidden("A guard refused this WebSocket connection.");
            }
          }
          return undefined;
        }
      : undefined;

  return Object.freeze({
    path: gateway.path,
    maxPayloadLength: gateway.maxPayloadLength,
    idleTimeoutMs: gateway.idleTimeoutMs,
    sendPings: gateway.sendPings,
    beforeHandle,
    initialize: (application: AnyElysia) => {
      injectWebSocketServer(gateway, instance, application);
      return invokeLifecycle(afterInit, instance, application);
    },
    open: (socket: WebSocketClient) => invokeSocketLifecycle(handleConnection, instance, socket),
    message: (socket: WebSocketClient, message: unknown) =>
      dispatchWebSocketMessage(
        socket,
        message,
        handlers,
        gateway.maxPayloadLength,
        filters,
        gateway,
        instance,
      ),
    close: (socket: WebSocketClient) => invokeSocketLifecycle(handleDisconnect, instance, socket),
  });
}

/**
 * Binds a request-scoped gateway once per socket.
 *
 * A request-scoped instance needs a context to be built in, and a socket
 * connection is the closest thing to a request a WebSocket has. The first
 * message or lifecycle call for a socket resolves its instance and caches the
 * bound methods; `afterInit` is skipped because no socket exists at boot, and
 * the handshake's guards run against a throwaway instance built with an empty
 * context.
 *
 * @internal
 */
export function bindRequestScopedWebSocketGateway(
  gateway: CompiledWebSocketGateway,
  container: AponiaContainer,
  guards: readonly CanActivate[],
  filters: readonly ResolvedFilter[],
): BoundWebSocketGateway {
  const boundBySocket = new WeakMap<object, BoundWebSocketGateway>();
  let application: AnyElysia | undefined;

  const resolveBound = (socket: WebSocketClient): BoundWebSocketGateway => {
    const existing = boundBySocket.get(socket as object);
    if (existing !== undefined) {
      return existing;
    }

    const instance = container.resolveModuleProvider(gateway.module, gateway.token, { socket });
    if (application !== undefined && isObject(instance)) {
      injectWebSocketServer(gateway, instance, application);
    }
    const bound = bindWebSocketGateway(gateway, instance, guards, filters);
    boundBySocket.set(socket as object, bound);
    return bound;
  };

  const handshake = bindWebSocketGateway(
    gateway,
    container.resolveModuleProvider(gateway.module, gateway.token, {}),
    guards,
    filters,
  );

  return Object.freeze({
    path: gateway.path,
    maxPayloadLength: gateway.maxPayloadLength,
    idleTimeoutMs: gateway.idleTimeoutMs,
    sendPings: gateway.sendPings,
    beforeHandle: handshake.beforeHandle,
    initialize: (nativeApplication: AnyElysia) => {
      application = nativeApplication;
    },
    open: (socket: WebSocketClient) => resolveBound(socket).open(socket),
    message: (socket: WebSocketClient, message: unknown) =>
      resolveBound(socket).message(socket, message),
    close: (socket: WebSocketClient) => resolveBound(socket).close(socket),
  });
}

/** @internal */
export function createGatewayExecutionContext(
  gateway: CompiledWebSocketGateway,
  instance: unknown,
  context: { readonly request: Request },
): ExecutionContext {
  const routeContext = context as unknown as RouteContext;
  const httpHost: HttpArgumentsHost = Object.freeze({ getRequest: () => routeContext });

  const handler = (
    isObject(instance) &&
    typeof (instance as Record<string, unknown>).handleConnection === "function"
      ? (instance as Record<string, unknown>).handleConnection
      : () => {}
  ) as (...arguments_: never[]) => unknown;

  return Object.freeze({
    getClass: <T>() => gateway.provider.useClass as ClassToken<T>,
    getHandler: () => handler,
    getRoute: () => Object.freeze({ method: "GET" as const, path: gateway.path }),
    getContext: () => routeContext,
    switchToHttp: () => httpHost,
    switchToRpc: () =>
      Object.freeze({
        getData: <T = unknown>(): T => undefined as unknown as T,
        getContext: <T = unknown>(): T => routeContext as unknown as T,
      }),
    switchToWs: () =>
      Object.freeze({
        getClient: <T = unknown>(): T => undefined as unknown as T,
        getData: <T = unknown>(): T => undefined as unknown as T,
        getPattern: () => "",
      }),
    getType: () => "ws" as const,
  });
}

/** @internal */
export function injectWebSocketServer(
  gateway: CompiledWebSocketGateway,
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

/** @internal */
export function resolveLifecycleMethod(
  gateway: CompiledWebSocketGateway,
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

/** @internal */
export function invokeLifecycle(
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

/** @internal */
export function invokeSocketLifecycle(
  method: GatewayLifecycleMethod | undefined,
  instance: object,
  socket: WebSocketClient,
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

/** @internal */
export function assertNoNativeWebSocketRouteCollisions(
  application: AnyElysia,
  gateways: readonly CompiledWebSocketGateway[],
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

/** @internal */
export function normalizeGatewayPath(path: string): string {
  const segment = path.trim().replace(/^\/+|\/+$/g, "");
  return segment.length === 0 ? "/" : `/${segment}`;
}

/** @internal */
export function invalidGateway(gateway: CompiledWebSocketGateway, message: string): AponiaError {
  return new AponiaError("INVALID_WEBSOCKET_GATEWAY", message, {
    module: gateway.module.id,
    gateway: gateway.gatewayName,
    token: getTokenName(gateway.token),
  });
}

/** @internal */
export function invalidGatewayDeclaration(
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

/** @internal */
export function invalidGatewayDefinition(
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
