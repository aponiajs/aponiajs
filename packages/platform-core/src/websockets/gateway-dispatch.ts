import {
  AponiaError,
  type CanActivate,
  type ClassToken,
  type ExecutionContext,
  type WsResponse,
} from "@aponiajs/common";
import type { GatewayHooks, GatewayPlan, GatewaySocket } from "./gateway.types.ts";

/** The error frame a client receives; never a stack or a cause. */
interface ExceptionFrame {
  readonly event: "exception";
  readonly data: { readonly code: string; readonly message: string };
}

/**
 * Builds the hooks one mounted gateway runs.
 *
 * The adapter protocol is one documented JSON envelope: a client sends
 * `{ event, data }`, a handler's ordinary result is emitted under the
 * subscribed event, and `WsResponse` selects another. `undefined` sends
 * nothing; `null`, `false`, and `0` are values and are sent.
 *
 * @param instance - The gateway provider's instance.
 * @param plan - The gateway's compiled plan.
 * @param guards - The resolved handshake guard instances.
 * @param server - The server reference injected into `@WebSocketServer()` properties.
 * @returns The hooks the host invokes.
 */
export function createGatewayDispatcher(
  gatewayInstance: object,
  plan: GatewayPlan,
  guards: readonly CanActivate[],
  server: unknown,
): GatewayHooks {
  const instance = gatewayInstance as Record<PropertyKey, unknown>;
  const byEvent = new Map(plan.handlers.map((handler) => [handler.event, handler]));

  return Object.freeze({
    async afterInit(): Promise<void> {
      await callLifecycle(instance, "afterInit", server);
    },
    async open(socket: GatewaySocket): Promise<void> {
      if (!(await admits(guards, socket, plan.path))) {
        socket.close(1008, "Forbidden");
        return;
      }
      await callLifecycle(instance, "handleConnection", socket);
    },
    async message(socket: GatewaySocket, raw: unknown): Promise<void> {
      const incoming = parseEnvelope(raw);
      if (incoming === undefined) {
        socket.send(exception("INVALID_WEBSOCKET_MESSAGE", "The message is not a valid envelope."));
        return;
      }

      const handler = byEvent.get(incoming.event);
      if (handler === undefined) {
        socket.send(exception("UNKNOWN_WEBSOCKET_EVENT", "No handler answers this event."));
        return;
      }

      const method = instance[handler.propertyKey];
      if (typeof method !== "function") {
        socket.send(exception("WEBSOCKET_HANDLER_ERROR", "The handler is missing."));
        return;
      }

      const arguments_ = handler.parameters.map((parameter) =>
        parameter.kind === "connected-socket"
          ? socket
          : parameter.property === undefined
            ? incoming.data
            : (incoming.data as Record<string, unknown> | null)?.[parameter.property],
      );

      try {
        const result = await (method as (...arguments_: unknown[]) => unknown).call(
          instance,
          ...arguments_,
        );
        const frame = frameFor(result, incoming.event);
        if (frame !== undefined) {
          socket.send(JSON.stringify(frame));
        }
      } catch (error) {
        socket.send(
          exception(
            error instanceof AponiaError ? error.code : "WEBSOCKET_HANDLER_ERROR",
            "The handler failed.",
          ),
        );
      }
    },
    async close(socket: GatewaySocket): Promise<void> {
      await callLifecycle(instance, "handleDisconnect", socket);
    },
  } satisfies GatewayHooks);
}

function frameFor(
  result: unknown,
  subscribedEvent: string,
): { readonly event: string; readonly data: unknown } | undefined {
  if (result === undefined) {
    return undefined;
  }
  if (isWsResponse(result)) {
    return { event: result.event, data: result.data };
  }
  return { event: subscribedEvent, data: result };
}

function isWsResponse(value: unknown): value is WsResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { event?: unknown }).event === "string" &&
    "data" in value
  );
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

function exception(code: string, message: string): string {
  const frame: ExceptionFrame = Object.freeze({
    event: "exception",
    data: Object.freeze({ code, message }),
  });
  return JSON.stringify(frame);
}

async function admits(
  guards: readonly CanActivate[],
  socket: GatewaySocket,
  path: string,
): Promise<boolean> {
  if (guards.length === 0) {
    return true;
  }
  const context = gatewayContext(socket, path);
  for (const guard of guards) {
    if (!(await guard.canActivate(context))) {
      return false;
    }
  }
  return true;
}

function gatewayContext(socket: GatewaySocket, path: string): ExecutionContext {
  const host = {
    getClient: () => socket,
    getData: () => undefined,
    getPattern: () => path,
  };
  return {
    getClass: () => undefined as never,
    getHandler: () => undefined as never,
    getRoute: () => ({ method: "ALL", path }),
    getContext: () => ({ request: undefined, socket }),
    getType: () => "ws",
    switchToHttp: () => {
      throw new AponiaError(
        "UNSUPPORTED_PLATFORM_FEATURE",
        "A WebSocket context has no HTTP view.",
        { feature: "websockets" },
      );
    },
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
