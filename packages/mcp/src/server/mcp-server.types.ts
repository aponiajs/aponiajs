/**
 * Options for configuring an McpServer instance.
 */
export interface McpServerOptions {
  readonly name: string;
  readonly version: string;
  /**
   * The handshake versions this server agrees to answer.
   *
   * A client asking for one of them is answered with it; anything else falls
   * back to `MCP_PROTOCOL_VERSION`, which is the version a client that states
   * none receives. Defaults to every version the package implements.
   */
  readonly protocolVersions?: readonly string[];
}
