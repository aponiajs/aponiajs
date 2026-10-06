/**
 * The official Model Context Protocol (MCP) version string.
 */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

/**
 * Standard JSON-RPC 2.0 error codes according to the specification.
 */
export const JSONRPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
