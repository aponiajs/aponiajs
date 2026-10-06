/**
 * JSON-RPC 2.0 message types and Model Context Protocol wire contracts.
 */

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
 * Result returned for the MCP initialize handshake.
 */
export interface McpInitializeResult {
  readonly protocolVersion: string;
  readonly capabilities: {
    readonly tools?: Record<string, unknown>;
    readonly logging?: Record<string, unknown>;
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
}
