import {
  type AponiaErrorCode,
  type ClassToken,
  type ExecutionContext,
  type HttpArgumentsHost,
  type RouteContext,
  type WsResponse,
} from "@aponiajs/common";
import type { ResolvedFilter } from "../controllers/enhancer.resolver.ts";
import type {
  CompiledWebSocketGateway,
  WebSocketClient,
  WebSocketMessageInvoker,
} from "../interfaces/websocket-gateway.interface.ts";

type WebSocketExceptionCode = Extract<
  AponiaErrorCode,
  "INVALID_WEBSOCKET_MESSAGE" | "UNKNOWN_WEBSOCKET_EVENT" | "WEBSOCKET_HANDLER_ERROR"
>;

/** @internal */
export interface IncomingWebSocketMessage {
  readonly event: string;
  readonly data: unknown;
}

/** @internal */
export function payloadByteLength(message: unknown): number {
  if (typeof message === "string") {
    return Buffer.byteLength(message);
  }
  if (message instanceof ArrayBuffer) {
    return message.byteLength;
  }
  if (ArrayBuffer.isView(message)) {
    return message.byteLength;
  }
  if (typeof message === "object" && message !== null) {
    try {
      return Buffer.byteLength(JSON.stringify(message));
    } catch {
      return 0;
    }
  }
  return 0;
}

/** @internal */
export async function dispatchWebSocketMessage(
  socket: WebSocketClient,
  message: unknown,
  handlers: ReadonlyMap<string, WebSocketMessageInvoker>,
  maxPayloadLength?: number,
  filters: readonly ResolvedFilter[] = [],
  gateway?: CompiledWebSocketGateway,
  instance?: unknown,
): Promise<void> {
  if (maxPayloadLength !== undefined && payloadByteLength(message) > maxPayloadLength) {
    sendException(
      socket,
      "INVALID_WEBSOCKET_MESSAGE",
      `WebSocket message exceeds the maximum payload limit of ${maxPayloadLength} bytes.`,
    );
    return;
  }

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
  } catch (error) {
    if (
      gateway !== undefined &&
      (await runGatewayFilters(error, incoming, socket, filters, gateway, instance))
    ) {
      return;
    }
    sendException(socket, "WEBSOCKET_HANDLER_ERROR", "The WebSocket handler failed.");
  }
}

/** A filter that answers replaces the exception frame; a decline leaves it. */
/** @internal */
export async function runGatewayFilters(
  error: unknown,
  incoming: IncomingWebSocketMessage,
  socket: WebSocketClient,
  filters: readonly ResolvedFilter[],
  gateway: CompiledWebSocketGateway,
  instance: unknown,
): Promise<boolean> {
  if (filters.length === 0) {
    return false;
  }

  const context = createMessageExecutionContext(gateway, instance, socket, incoming);
  for (const filter of filters) {
    if (!matchesCaught(error, filter.catch)) {
      continue;
    }
    try {
      const answer = await filter.instance.catch(error, context);
      if (answer !== undefined && answer !== null) {
        await emitHandlerResult(socket, incoming.event, answer);
        return true;
      }
    } catch {
      // A filter that throws declines; the exception frame answers.
    }
  }

  return false;
}

/** @internal */
export function matchesCaught(error: unknown, caught: readonly ClassToken<unknown>[]): boolean {
  return caught.length === 0 || caught.some((type) => error instanceof type);
}

/** @internal */
export function createMessageExecutionContext(
  gateway: CompiledWebSocketGateway,
  instance: unknown,
  socket: WebSocketClient,
  incoming: IncomingWebSocketMessage,
): ExecutionContext {
  const routeContext = Object.freeze({
    body: incoming.data,
    cookie: {},
    headers: {},
    params: {},
    path: gateway.path,
    query: {},
    request: new Request(`http://localhost${gateway.path}`),
    set: { headers: {} },
  }) as unknown as RouteContext;
  const httpHost: HttpArgumentsHost = Object.freeze({ getRequest: () => routeContext });
  const handler = gateway.handlers.find((entry) => entry.event === incoming.event);

  return Object.freeze({
    getClass: <T>() => gateway.provider.useClass as ClassToken<T>,
    getHandler: () =>
      (handler === undefined
        ? () => undefined
        : () => (instance as Record<PropertyKey, unknown>)[handler.propertyKey]) as (
        ...arguments_: never[]
      ) => unknown,
    getRoute: () => Object.freeze({ method: "ALL" as const, path: gateway.path }),
    getContext: () => routeContext,
    switchToHttp: () => httpHost,
    switchToRpc: () =>
      Object.freeze({
        getData: <T = unknown>(): T => incoming.data as T,
        getContext: <T = unknown>(): T => socket as unknown as T,
      }),
    switchToWs: () =>
      Object.freeze({
        getClient: <T = unknown>(): T => socket as unknown as T,
        getData: <T = unknown>(): T => incoming.data as T,
        getPattern: () => incoming.event,
      }),
    getType: () => "ws" as const,
  });
}

/** @internal */
export async function emitHandlerResult(
  socket: WebSocketClient,
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

/** @internal */
export async function emitHandlerValue(
  socket: WebSocketClient,
  subscribedEvent: string,
  value: unknown,
): Promise<void> {
  const resolved = typeof (value as Promise<unknown>)?.then === "function" ? await value : value;
  if (resolved === undefined) {
    return;
  }

  const response = isWsResponse(resolved)
    ? Object.freeze({ event: resolved.event, data: resolved.data })
    : Object.freeze({ event: subscribedEvent, data: resolved });
  socket.send(response);
}

/** @internal */
export function parseIncomingMessage(message: unknown): IncomingWebSocketMessage | undefined {
  let candidate = message;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return undefined;
    }
  }
  if (typeof candidate !== "object" || candidate === null) {
    return undefined;
  }

  try {
    const event = (candidate as Record<string, unknown>).event;
    if (typeof event !== "string" || event.trim().length === 0) {
      return undefined;
    }
    return { event, data: (candidate as Record<string, unknown>).data };
  } catch {
    return undefined;
  }
}

/** @internal */
export function isWsResponse(value: unknown): value is WsResponse {
  if (!isObject(value) || !Object.hasOwn(value, "data")) {
    return false;
  }

  const event = Reflect.get(value, "event") as unknown;
  return typeof event === "string" && event.trim().length > 0;
}

/** @internal */
export function isAsyncIterator(value: unknown): value is AsyncIterableIterator<unknown> {
  return (
    isObject(value) &&
    typeof Reflect.get(value, "next") === "function" &&
    typeof Reflect.get(value, Symbol.asyncIterator) === "function"
  );
}

/** @internal */
export function isSyncIterator(value: unknown): value is IterableIterator<unknown> {
  return (
    isObject(value) &&
    typeof Reflect.get(value, "next") === "function" &&
    typeof Reflect.get(value, Symbol.iterator) === "function"
  );
}

/** @internal */
export function sendException(
  socket: WebSocketClient,
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

/** @internal */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof Reflect.get(value, "then") === "function"
  );
}

/** @internal */
export function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}
