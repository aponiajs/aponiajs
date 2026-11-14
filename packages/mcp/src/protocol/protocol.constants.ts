/**
 * The protocol version a client that states none receives.
 *
 * It stays the original handshake version so an existing client keeps the
 * answer it was built against; a client that asks for a newer supported
 * version negotiates that one.
 */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

/** The newest handshake version the server implements. */
export const MCP_LATEST_PROTOCOL_VERSION = "2025-11-25";

/** Every handshake version the server can answer. */
export const MCP_PROTOCOL_VERSIONS = Object.freeze([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
] as const);

/** The stateless discovery method a multi-version client asks first. */
export const MCP_DISCOVER_METHOD = "server/discover";

/** The `_meta` key a stateless request states its protocol version under. */
export const MCP_PROTOCOL_META_KEY = "io.modelcontextprotocol/protocolVersion";

/** The `_meta` key a stateless request states its client capabilities under. */
export const MCP_CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities";

/** The `_meta` key a stateless request states its client info under. */
export const MCP_CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";

/** The HTTP header a stateless request repeats its protocol version in. */
export const MCP_PROTOCOL_VERSION_HEADER = "mcp-protocol-version";

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
