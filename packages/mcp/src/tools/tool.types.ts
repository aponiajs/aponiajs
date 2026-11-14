import type { McpToolCallResult } from "../protocol/protocol.types.ts";

/**
 * Standard JSON schema structure for tool input arguments.
 */
export interface McpToolInputSchema {
  readonly type: "object";
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

/**
 * Declaration of an MCP tool.
 */
export interface McpToolDefinition<TArgs = Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: McpToolInputSchema;
  /**
   * The JSON object the tool answers as `structuredContent`.
   *
   * A tool that declares one should also answer that object in the result; the
   * declaration alone does not change the call.
   */
  readonly outputSchema?: McpToolInputSchema;
  readonly handler: (args: TArgs) => Promise<McpToolCallResult> | McpToolCallResult;
}

/**
 * Wire representation of a tool returned in `tools/list`.
 */
export interface McpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: McpToolInputSchema;
  readonly outputSchema?: McpToolInputSchema;
}
