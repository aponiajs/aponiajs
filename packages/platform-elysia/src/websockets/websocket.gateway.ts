import {
  AponiaError,
  getEnhancerMetadata,
  type CanActivate,
  type ClassToken,
  type EnhancerMetadata,
  type ModuleDefinition,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import type { AnyElysia } from "elysia";
import type { ResolvedFilter } from "../controllers/enhancer.resolver.ts";
import { resolveEnhancers } from "../controllers/enhancer.resolver.ts";
import {
  assertNoNativeWebSocketRouteCollisions,
  bindRequestScopedWebSocketGateway,
  bindWebSocketGateway,
} from "./gateway-binding.ts";
import { compileGateway, readGatewayPlan } from "./gateway-plan.ts";
import type {
  CompiledWebSocketGateway,
  WebSocketClient,
} from "../interfaces/websocket-gateway.interface.ts";

export { bindWebSocketGateway };

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
export function compileWebSocketGateways(
  modules: readonly ModuleDefinition[],
): readonly CompiledWebSocketGateway[] {
  const gateways: CompiledWebSocketGateway[] = [];
  const paths = new Map<string, CompiledWebSocketGateway>();

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
export async function registerWebSocketGateways(
  application: AnyElysia,
  container: AponiaContainer,
  gateways: readonly CompiledWebSocketGateway[],
): Promise<void> {
  const boundGateways = gateways.map((gateway) => {
    const location = container.graph.locate(gateway.module, gateway.token);
    const resolvedGuards = (gateway.guards ?? []).map(
      (guardToken) => container.resolveModuleProvider(gateway.module, guardToken) as CanActivate,
    );
    const filters = resolveGatewayFilters(container, gateway);
    if (container.providerScope(location.module, location.provider) === "request") {
      return bindRequestScopedWebSocketGateway(gateway, container, resolvedGuards, filters);
    }
    const instance = container.resolveModuleProvider(gateway.module, gateway.token);
    return bindWebSocketGateway(gateway, instance, resolvedGuards, filters);
  });
  assertNoNativeWebSocketRouteCollisions(application, gateways);

  // `ws` infers its socket context from the hook it is handed, the same way
  // `method` infers a route's schema from one. These handlers are written
  // against `WebSocketClient` instead, so the call states the signature it
  // needs. This module is the only place the platform registers a WebSocket
  // route, which is where that cast belongs.
  const nativeApplication = application as unknown as {
    readonly ws: (
      path: string,
      hook: {
        beforeHandle?: (context: { readonly request: Request }) => unknown;
        maxPayloadLength?: number;
        idleTimeout?: number;
        sendPings?: boolean;
        open(socket: WebSocketClient): unknown;
        message(socket: WebSocketClient, message: unknown): unknown;
        close(socket: WebSocketClient): unknown;
      },
    ) => unknown;
  };

  for (const gateway of boundGateways) {
    nativeApplication.ws(gateway.path, {
      ...(gateway.beforeHandle !== undefined ? { beforeHandle: gateway.beforeHandle } : {}),
      ...(gateway.maxPayloadLength !== undefined
        ? { maxPayloadLength: gateway.maxPayloadLength }
        : {}),
      ...(gateway.idleTimeoutMs === undefined
        ? {}
        : { idleTimeout: Math.max(1, Math.ceil(gateway.idleTimeoutMs / 1_000)) }),
      ...(gateway.sendPings === undefined ? {} : { sendPings: gateway.sendPings }),
      open: (socket: WebSocketClient) => gateway.open(socket),
      message: (socket: WebSocketClient, message: unknown) => gateway.message(socket, message),
      close: (socket: WebSocketClient) => gateway.close(socket),
    });
  }

  for (const gateway of boundGateways) {
    await gateway.initialize(application);
  }
}

function resolveGatewayFilters(
  container: AponiaContainer,
  gateway: CompiledWebSocketGateway,
): readonly ResolvedFilter[] {
  const metadata = getEnhancerMetadata(gateway.provider.useClass as ClassToken<unknown>);
  if (metadata === undefined || metadata.filters.length === 0) {
    return Object.freeze([]);
  }

  const declared: EnhancerMetadata = Object.freeze({
    guards: Object.freeze([]),
    interceptors: Object.freeze([]),
    filters: metadata.filters,
  });
  return resolveEnhancers(container, gateway.module, declared).filters;
}
