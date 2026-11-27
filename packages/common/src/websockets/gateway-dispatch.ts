import { AponiaError } from "../exceptions/aponia-error.ts";
import { type CanActivate, type ExecutionContext } from "../interfaces/enhancer.interface.ts";
import { type ClassToken } from "../interfaces/token.interface.ts";
import { type RouteValidatorInput } from "../interfaces/validation.interface.ts";
import { type WsResponse } from "../interfaces/websocket-gateway.interface.ts";
import { matchesFilter } from "../kernel/filter-matching.ts";
import type { ResolvedFilter } from "../interfaces/kernel.interface.ts";
import { validateSlot } from "../kernel/validation.ts";
import type {
  GatewayHooks,
  GatewayPlan,
  GatewayServer,
  GatewaySocket,
} from "../interfaces/gateway.interface.ts";

/**
 * Builds the hooks one mounted gateway runs.
 *
 * The adapter protocol is one documented JSON envelope: a client sends
 * `{ event, data }`, a handler's ordinary result is emitted under the
 * subscribed event, and `WsResponse` selects another. `undefined` sends
 * nothing; `null`, `false`, and `0` are values and are sent. A declared payload
 * schema is validated before the handler runs, a payload above the plan's limit
 * is refused, a sync or async iterator is streamed in order, and a failure is
 * offered to the gateway's filters before the standard exception frame.
 *
 * @param gatewayInstance - The gateway provider's instance.
 * @param plan - The gateway's compiled plan.
 * @param guards - The resolved handshake guard instances.
 * @param filtersByEvent - The resolved filters for each event, most-specific-first.
 * @returns The hooks the host invokes.
 */
export interface GatewayDispatcher extends GatewayHooks {
  /** The server reference a `@WebSocketServer()` property receives. */
  readonly server: GatewayServer;
}

const utf8 = new TextEncoder();

/** Builds the WebSocket gateway message and lifecycle dispatcher. */
export function createGatewayDispatcher(
  gatewayInstance: object,
  plan: GatewayPlan,
  guards: readonly CanActivate[],
  filtersByEvent: ReadonlyMap<string, readonly ResolvedFilter[]> = new Map(),
): GatewayDispatcher {
  const peers = new Set<GatewaySocket>();
  const peersById = new Map<string, GatewaySocket>();
  const admitted = new WeakSet<GatewaySocket>();
  const admittedIds = new Set<string>();
  const admissions = new WeakMap<GatewaySocket, Promise<boolean>>();
  const admissionsById = new Map<string, Promise<boolean>>();
  const addPeer = (socket: GatewaySocket): void => {
    if (socket.id === undefined) {
      peers.add(socket);
    } else {
      peersById.set(socket.id, socket);
    }
  };
  const removePeer = (socket: GatewaySocket): void => {
    if (socket.id === undefined) {
      peers.delete(socket);
    } else {
      peersById.delete(socket.id);
    }
  };
  const isAdmitted = (socket: GatewaySocket): boolean =>
    socket.id === undefined ? admitted.has(socket) : admittedIds.has(socket.id);
  const admissionFor = (socket: GatewaySocket): Promise<boolean> | undefined =>
    socket.id === undefined ? admissions.get(socket) : admissionsById.get(socket.id);
  const broadcast = (event: string, data: unknown): void => {
    const frame = encode(event, data);
    for (const peer of [...peers, ...peersById.values()]) {
      peer.send(frame);
    }
  };
  const gatewayServer: GatewayServer = Object.freeze({ emit: broadcast });
  const instance = gatewayInstance as Record<PropertyKey, unknown>;
  const byEvent = new Map(plan.handlers.map((handler) => [handler.event, handler]));

  return Object.freeze({
    server: gatewayServer,
    broadcast,
    async afterInit(): Promise<void> {
      await callLifecycle(instance, "afterInit", gatewayServer);
    },
    async open(socket: GatewaySocket): Promise<void> {
      const admission = (async (): Promise<boolean> => {
        try {
          if (!(await admits(guards, socket, plan.path, gatewayInstance))) {
            socket.close(1008, "Forbidden");
            return false;
          }
          if (socket.id === undefined) {
            admitted.add(socket);
          } else {
            admittedIds.add(socket.id);
          }
          addPeer(socket);
          await callLifecycle(instance, "handleConnection", socket);
          return true;
        } catch {
          if (socket.id === undefined) {
            admitted.delete(socket);
          } else {
            admittedIds.delete(socket.id);
          }
          removePeer(socket);
          socket.close(1011, "Handshake failed");
          return false;
        }
      })();
      if (socket.id === undefined) {
        admissions.set(socket, admission);
      } else {
        admissionsById.set(socket.id, admission);
      }
      await admission;
    },
    async message(socket: GatewaySocket, raw: unknown): Promise<void> {
      const pendingAdmission = admissionFor(socket);
      if (pendingAdmission !== undefined && !(await pendingAdmission)) {
        socket.close(1008, "Forbidden");
        return;
      }
      if (guards.length > 0 && !isAdmitted(socket)) {
        socket.close(1008, "Forbidden");
        return;
      }
      if (plan.maxPayloadLength !== undefined && payloadByteLength(raw) > plan.maxPayloadLength) {
        sendException(
          socket,
          "INVALID_WEBSOCKET_MESSAGE",
          "The message exceeds the gateway payload limit.",
        );
        return;
      }

      const incoming = parseEnvelope(raw);
      if (incoming === undefined) {
        sendException(socket, "INVALID_WEBSOCKET_MESSAGE", "The message is not a valid envelope.");
        return;
      }

      const handler = byEvent.get(incoming.event);
      if (handler === undefined) {
        sendException(socket, "UNKNOWN_WEBSOCKET_EVENT", "No handler answers this event.");
        return;
      }

      const method = instance[handler.propertyKey];
      if (typeof method !== "function") {
        sendException(socket, "WEBSOCKET_HANDLER_ERROR", "The handler is missing.");
        return;
      }

      let data = incoming.data;
      if (handler.schema?.data !== undefined) {
        try {
          data = await validateSlot(
            handler.schema.data as RouteValidatorInput,
            data,
            "body",
            false,
          );
        } catch {
          sendException(
            socket,
            "INVALID_WEBSOCKET_MESSAGE",
            "The message payload did not match the handler schema.",
          );
          return;
        }
      }

      const arguments_ = handler.parameters.map((parameter) =>
        parameter.kind === "connected-socket"
          ? socket
          : parameter.property === undefined
            ? data
            : (data as Record<string, unknown> | null)?.[parameter.property],
      );

      try {
        const result = await (method as (...arguments_: unknown[]) => unknown).call(
          instance,
          ...arguments_,
        );
        await emitResult(socket, incoming.event, result);
      } catch (error) {
        const answered = await runFilters(
          filtersByEvent.get(incoming.event) ?? [],
          error,
          socket,
          plan.path,
          gatewayInstance,
        );
        if (answered !== undefined && answered !== DECLINED) {
          await emitResult(socket, incoming.event, answered);
          return;
        }
        sendException(
          socket,
          error instanceof AponiaError ? error.code : "WEBSOCKET_HANDLER_ERROR",
          "The handler failed.",
        );
      }
    },
    async close(socket: GatewaySocket): Promise<void> {
      if (socket.id === undefined) {
        admitted.delete(socket);
      } else {
        admittedIds.delete(socket.id);
      }
      removePeer(socket);
      await callLifecycle(instance, "handleDisconnect", socket);
    },
  } satisfies GatewayDispatcher);
}

/** A filter that answered with `undefined` or `null` declines the failure. */
const DECLINED = Symbol("declined");

async function runFilters(
  filters: readonly ResolvedFilter[],
  error: unknown,
  socket: GatewaySocket,
  path: string,
  gatewayInstance: object,
): Promise<unknown> {
  if (filters.length === 0) {
    return DECLINED;
  }
  const context = gatewayContext(socket, path, gatewayInstance);
  for (const filter of filters) {
    if (!matchesFilter(filter.exceptions, error)) {
      continue;
    }
    try {
      const answer = await filter.instance.catch(error, context);
      if (answer !== undefined && answer !== null) {
        return answer;
      }
    } catch {
      // A filter that throws declines; the standard frame answers.
    }
  }
  return DECLINED;
}

async function emitResult(
  socket: GatewaySocket,
  subscribedEvent: string,
  result: unknown,
): Promise<void> {
  if (isAsyncIterator(result)) {
    for await (const value of result) {
      await emitValue(socket, subscribedEvent, value);
    }
    return;
  }
  if (isSyncIterator(result)) {
    for (const value of result) {
      await emitValue(socket, subscribedEvent, value);
    }
    return;
  }
  await emitValue(socket, subscribedEvent, result);
}

async function emitValue(
  socket: GatewaySocket,
  subscribedEvent: string,
  value: unknown,
): Promise<void> {
  const resolved =
    typeof (value as Promise<unknown> | undefined)?.then === "function" ? await value : value;
  if (resolved === undefined) {
    return;
  }
  if (isWsResponse(resolved)) {
    socket.emit(resolved.event, resolved.data);
    return;
  }
  socket.emit(subscribedEvent, resolved);
}

function isWsResponse(value: unknown): value is WsResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { event?: unknown }).event === "string" &&
    "data" in value
  );
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

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function payloadByteLength(message: unknown): number {
  if (typeof message === "string") {
    return utf8.encode(message).byteLength;
  }
  if (message instanceof ArrayBuffer) {
    return message.byteLength;
  }
  if (ArrayBuffer.isView(message)) {
    return message.byteLength;
  }
  if (typeof message === "object" && message !== null) {
    try {
      return utf8.encode(JSON.stringify(message)).byteLength;
    } catch {
      return 0;
    }
  }
  return 0;
}

function sendException(socket: GatewaySocket, code: string, message: string): void {
  socket.emit("exception", Object.freeze({ code, message }));
}

function parseEnvelope(
  raw: unknown,
): { readonly event: string; readonly data: unknown } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { event?: unknown }).event !== "string"
  ) {
    return undefined;
  }
  return {
    event: (parsed as { event: string }).event,
    data: (parsed as { data?: unknown }).data,
  };
}

function encode(event: string, data: unknown): string {
  return JSON.stringify({ event, data });
}

async function admits(
  guards: readonly CanActivate[],
  socket: GatewaySocket,
  path: string,
  gatewayInstance: object,
): Promise<boolean> {
  if (guards.length === 0) {
    return true;
  }
  const context = gatewayContext(socket, path, gatewayInstance);
  for (const guard of guards) {
    try {
      if (!(await guard.canActivate(context))) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

function gatewayContext(
  socket: GatewaySocket,
  path: string,
  gatewayInstance: object,
): ExecutionContext {
  const host = {
    getClient: () => socket,
    getData: () => undefined,
    getPattern: () => path,
  };
  const request = socket.request ?? new Request(`http://localhost${path}`);
  const gatewayClass = gatewayInstance.constructor as ClassToken<unknown>;
  const routeContext = {
    body: undefined,
    cookie: Object.freeze({}),
    headers: Object.freeze(Object.fromEntries(request.headers)),
    params: Object.freeze({}),
    path,
    query: Object.freeze({}),
    request,
    set: { headers: {} },
    store: Object.freeze({}),
  };
  return {
    getClass: () => gatewayClass,
    getHandler: () =>
      ((gatewayInstance as { readonly handleConnection?: unknown }).handleConnection ??
        (() => undefined)) as never,
    getRoute: () => ({ method: "ALL", path }),
    getContext: () => ({ request, socket }),
    getType: () => "ws",
    switchToHttp: () => ({ getRequest: () => routeContext }),
    switchToRpc: () => host,
    switchToWs: () => host,
  } as unknown as ExecutionContext;
}

async function callLifecycle(
  instance: Record<PropertyKey, unknown>,
  name: "afterInit" | "handleConnection" | "handleDisconnect",
  argument: unknown,
): Promise<void> {
  const method = instance[name];
  if (typeof method === "function") {
    await (method as (value: unknown) => unknown).call(instance, argument);
  }
}

/** Reads the server-reference properties a gateway declares. */
export function injectGatewayServer(
  gatewayInstance: object,
  properties: readonly (string | symbol)[],
  server: unknown,
): void {
  for (const property of properties) {
    Object.defineProperty(gatewayInstance, property, {
      value: server,
      enumerable: false,
      writable: false,
      configurable: true,
    });
  }
}

/** One class a module registered as a gateway provider. */
export interface GatewayProvider {
  /** The class the provider instantiates. */
  readonly useClass: ClassToken<unknown>;
}
