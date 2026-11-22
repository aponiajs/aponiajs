/**
 * The endpoint policy an application declares, as data a configuration carries.
 *
 * Every field is a value an environment can supply. The server itself, and the
 * `authorize` decision, are live values and stay in the module options.
 */
export interface McpConfiguration {
  /**
   * The path the MCP endpoint answers on.
   *
   * Defaults to `"/mcp"` and must be an absolute path. The path is read once
   * while the module mounts, so a value the schema refuses fails the boot
   * rather than a request.
   */
  readonly path?: string;
  /**
   * The origins allowed to reach the endpoint from a browser.
   *
   * Defaults to an empty list, which refuses every request carrying an
   * `Origin` header. A native client sends no `Origin` and is unaffected.
   */
  readonly allowedOrigins?: readonly string[];
  /**
   * Whether the endpoint answers without an `authorize` decision.
   *
   * Defaults to `false`. The registration refuses to mount unless this is
   * `true` or the module options carry an `authorize` callback.
   */
  readonly allowUnauthenticated?: boolean;
}

/**
 * The policy the plugin reads after validation.
 *
 * @internal
 */
export interface McpPolicy {
  readonly path: string;
  readonly allowedOrigins: readonly string[];
  readonly allowUnauthenticated: boolean;
}
