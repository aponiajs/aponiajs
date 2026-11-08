/**
 * Model Context Protocol server and tool registry for AponiaJS.
 *
 * The server negotiates the handshake versions 2024-11-05 through 2025-11-25,
 * answers `server/discover` for stateless clients, and publishes tool output
 * schemas beside each tool.
 */

export {
  JSONRPC_ERROR_CODES,
  MCP_CLIENT_CAPABILITIES_META_KEY,
  MCP_CLIENT_INFO_META_KEY,
  MCP_DISCOVER_METHOD,
  MCP_LATEST_PROTOCOL_VERSION,
  MCP_PROTOCOL_META_KEY,
  MCP_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
  MCP_PROTOCOL_VERSION_HEADER,
} from "./protocol/protocol.constants.ts";
export type {
  JsonRpcError,
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  McpClientInfo,
  McpDiscoverParams,
  McpDiscoverResult,
  McpGetPromptResult,
  McpInitializeParams,
  McpInitializeResult,
  McpPromptMessage,
  McpReadResourceResult,
  McpResourceContent,
  McpServerInfo,
  McpToolCallResult,
  McpToolContentItem,
} from "./protocol/protocol.types.ts";

export { McpServer } from "./server/mcp-server.ts";
export type { McpServerOptions } from "./server/mcp-server.types.ts";
export { createStatelessHttpHandler } from "./server/http-handler.ts";

export { defineMcpTool } from "./tools/define-tool.ts";
export { McpToolRegistry } from "./tools/tool-registry.ts";
export { McpResourceRegistry, defineMcpResource } from "./resources/resource-registry.ts";
export { McpPromptRegistry, defineMcpPrompt } from "./prompts/prompt-registry.ts";
export type {
  McpToolDefinition,
  McpToolDescriptor,
  McpToolInputSchema,
} from "./tools/tool.types.ts";
export type { McpResourceDefinition, McpResourceDescriptor } from "./resources/resource.types.ts";
export type {
  McpPromptDefinition,
  McpPromptDescriptor,
  McpPromptArgument,
} from "./prompts/prompt.types.ts";
