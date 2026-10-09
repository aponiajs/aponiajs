import type { McpToolDefinition } from "./tool.types.ts";

/**
 * Creates an immutable, validated MCP tool definition.
 *
 * @param definition - The tool configuration and execution handler.
 * @returns Frozen MCP tool definition.
 */
export function defineMcpTool<TArgs = Record<string, unknown>>(
  definition: McpToolDefinition<TArgs>,
): McpToolDefinition<TArgs> {
  return Object.freeze({
    name: definition.name,
    description: definition.description,
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({ ...definition.inputSchema.properties }),
      required: Object.freeze([...(definition.inputSchema.required ?? [])]),
      additionalProperties: definition.inputSchema.additionalProperties,
    }),
    handler: definition.handler,
  });
}
