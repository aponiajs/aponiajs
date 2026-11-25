import {
  getEnhancerMetadata,
  getWebSocketGatewayMetadata,
  getWebSocketMessageMetadata,
  getWebSocketParameterMetadata,
  type ClassToken,
} from "@aponiajs/common";
import type { GatewayPlan } from "../interfaces/gateway.interface.ts";

/**
 * Reads one class's gateway declaration into the plan a host mounts.
 *
 * @param gateway - The class a module registers as a provider.
 * @returns The plan, or `undefined` when the class declares no gateway.
 */
export function compileGatewayPlan(gateway: ClassToken<unknown>): GatewayPlan | undefined {
  const metadata = getWebSocketGatewayMetadata(gateway);
  if (metadata === undefined) {
    return undefined;
  }

  const handlers = getWebSocketMessageMetadata(gateway).map((message) => {
    const filters = getEnhancerMetadata(gateway, message.propertyKey).filters;
    return Object.freeze({
      event: message.event,
      propertyKey: message.propertyKey,
      parameters: getWebSocketParameterMetadata(gateway, message.propertyKey),
      ...(message.schema === undefined ? {} : { schema: message.schema }),
      ...(filters.length === 0 ? {} : { filters }),
    });
  });

  const filters = getEnhancerMetadata(gateway).filters;

  return Object.freeze({
    path: metadata.path,
    handlers: Object.freeze(handlers),
    guards: Object.freeze(metadata.guards ?? []),
    ...(filters.length === 0 ? {} : { filters }),
    ...(metadata.maxPayloadLength === undefined
      ? {}
      : { maxPayloadLength: metadata.maxPayloadLength }),
    ...(metadata.origins === undefined ? {} : { origins: metadata.origins }),
    ...(metadata.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: metadata.idleTimeoutMs }),
    ...(metadata.sendPings === undefined ? {} : { sendPings: metadata.sendPings }),
  });
}
