/**
 * Standardized Model Context Protocol (MCP 2024-11-05) Server & Tools for AponiaJS.
 */

export { MCP_PROTOCOL_VERSION, JSONRPC_ERROR_CODES } from "./protocol/protocol.constants.ts";
export type {
  JsonRpcError,
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  McpClientInfo,
  McpInitializeParams,
  McpInitializeResult,
  McpServerInfo,
  McpToolCallResult,
  McpToolContentItem,
} from "./protocol/protocol.types.ts";

export { McpServer } from "./server/mcp-server.ts";
export type { McpServerOptions } from "./server/mcp-server.types.ts";
export { createStatelessHttpHandler } from "./server/http-handler.ts";

export { defineMcpTool } from "./tools/define-tool.ts";
export { McpToolRegistry } from "./tools/tool-registry.ts";
export type {
  McpToolDefinition,
  McpToolDescriptor,
  McpToolInputSchema,
} from "./tools/tool.types.ts";
