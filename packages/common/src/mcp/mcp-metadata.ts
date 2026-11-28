import type { McpPrimitiveMetadata } from "../interfaces/mcp.interface.ts";

/** Symbol key storing MCP primitive metadata on a provider prototype. */
export const mcpPrimitivesMetadataKey = Symbol.for("aponia.mcp.primitives.metadata");

/**
 * The primitives one provider prototype declares.
 *
 * @param prototype - The provider prototype decorators wrote to.
 * @returns A frozen map keyed by method name.
 */
export function getMcpPrimitiveMetadata(
  prototype: object,
): ReadonlyMap<string | symbol, McpPrimitiveMetadata> {
  const recorded = Reflect.getMetadata(mcpPrimitivesMetadataKey, prototype) as
    | Map<string | symbol, McpPrimitiveMetadata>
    | undefined;

  return recorded === undefined ? new Map() : new Map(recorded);
}
