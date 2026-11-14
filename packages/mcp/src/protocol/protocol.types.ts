/**
 * JSON-RPC 2.0 message types and Model Context Protocol wire contracts.
 */
import type {
  MCP_CLIENT_CAPABILITIES_META_KEY,
  MCP_CLIENT_INFO_META_KEY,
  MCP_PROTOCOL_META_KEY,
} from "./protocol.constants.ts";

/**
 * Identifier for JSON-RPC 2.0 request or response.
 */
export type JsonRpcId = string | number | null;

/**
 * Standard JSON-RPC 2.0 request message.
 */
export interface JsonRpcRequest<TParams = Record<string, unknown>> {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: TParams;
}

/**
 * Standard JSON-RPC 2.0 notification message without an id.
 */
export interface JsonRpcNotification<TParams = Record<string, unknown>> {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: TParams;
}

/**
 * Standard JSON-RPC 2.0 error object.
 */
export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/**
 * Successful JSON-RPC 2.0 response.
 */
export interface JsonRpcSuccessResponse<TResult = unknown> {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result: TResult;
}

/**
 * Erroneous JSON-RPC 2.0 response.
 */
export interface JsonRpcErrorResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly error: JsonRpcError;
}

/**
 * Union of valid JSON-RPC 2.0 responses.
 */
export type JsonRpcResponse<TResult = unknown> =
  | JsonRpcSuccessResponse<TResult>
  | JsonRpcErrorResponse;

/**
 * Information about the MCP server.
 */
export interface McpServerInfo {
  readonly name: string;
  readonly version: string;
}

/**
 * Information about the connected MCP client.
 */
export interface McpClientInfo {
  readonly name: string;
  readonly version: string;
}

/**
 * Parameters for the MCP initialize handshake.
 */
export interface McpInitializeParams {
  readonly protocolVersion: string;
  readonly capabilities: Record<string, unknown>;
  readonly clientInfo: McpClientInfo;
}

/**
 * Parameters for a stateless `server/discover` request.
 *
 * The per-request meta object is how the 2026-07-28 revision replaces the
 * handshake: a client states the protocol version and capabilities it offers
 * on the request itself. Only the members this server reads are typed.
 */
export interface McpDiscoverParams {
  readonly _meta?: {
    readonly [MCP_PROTOCOL_META_KEY]?: string;
    readonly [MCP_CLIENT_CAPABILITIES_META_KEY]?: Record<string, unknown>;
    readonly [MCP_CLIENT_INFO_META_KEY]?: McpClientInfo;
    readonly [key: string]: unknown;
  };
}

/**
 * Result returned for `server/discover`.
 */
export interface McpDiscoverResult {
  readonly protocolVersions: readonly string[];
  readonly capabilities: {
    readonly tools?: Record<string, unknown>;
    readonly logging?: Record<string, unknown>;
    readonly resources?: Record<string, unknown>;
    readonly prompts?: Record<string, unknown>;
  };
  readonly serverInfo: McpServerInfo;
}

/**
 * Result returned for the MCP initialize handshake.
 */
export interface McpInitializeResult {
  readonly protocolVersion: string;
  readonly capabilities: {
    readonly tools?: Record<string, unknown>;
    readonly logging?: Record<string, unknown>;
    readonly resources?: Record<string, unknown>;
    readonly prompts?: Record<string, unknown>;
  };
  readonly serverInfo: McpServerInfo;
}

/**
 * Content block inside an MCP tool call result.
 */
export interface McpToolContentItem {
  readonly type: "text" | "image" | "resource";
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
}

/**
 * Structured result returned by an MCP tool execution.
 */
export interface McpToolCallResult {
  readonly content: readonly McpToolContentItem[];
  readonly isError?: boolean;
  /**
   * The JSON object a tool with an `outputSchema` answers.
   *
   * The specification requires this member to be an object when present; a
   * tool that answers an array or a scalar states it in the text content only.
   */
  readonly structuredContent?: Record<string, unknown>;
}

/** One body a resource read answers. */
export interface McpResourceContent {
  readonly uri: string;
  readonly mimeType?: string;
  readonly text?: string;
  readonly blob?: string;
}

/** The result of `resources/read`. */
export interface McpReadResourceResult {
  readonly contents: readonly McpResourceContent[];
}

/** One message a prompt returns. */
export interface McpPromptMessage {
  readonly role: "user" | "assistant";
  readonly content: McpToolContentItem;
}

/** The result of `prompts/get`. */
export interface McpGetPromptResult {
  readonly description?: string;
  readonly messages: readonly McpPromptMessage[];
}
