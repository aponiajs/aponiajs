import type { ConfigurationToken, ModuleImport, Token, TokenMap } from "@aponiajs/common";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpConfiguration } from "../policy/mcp-policy.types.ts";

/**
 * Builds one MCP server.
 *
 * Called once per request in stateless mode and once per session in stateful
 * mode, because an SDK server connects to exactly one transport. A factory that
 * closes over injected providers is what lets a tool read application state.
 */
export type McpServerFactory = () => McpServer;

/** The authentication decision the endpoint asks before a tool runs. */
export type McpAuthorize = (request: Request) => boolean | Promise<boolean>;

/**
 * How an application declares its MCP endpoint in its `imports`.
 *
 * The policy arrives through `configuration`, which is validated at boot, and
 * the tools arrive through `useFactory`, which is where dependency injection
 * reaches a tool handler. The factory returns a server factory rather than a
 * server, because a stateless endpoint serves each request with its own server.
 */
export interface McpModuleOptions<TDependencies extends readonly Token<unknown>[] = readonly []> {
  /**
   * The declaration whose value states the endpoint path, origins, and the
   * unauthenticated switch.
   *
   * The module provides and exports this token itself, so the application can
   * read back the same validated value the endpoint was built from.
   */
  readonly configuration: ConfigurationToken<McpConfiguration>;
  /** Modules whose exports the factory may inject. */
  readonly imports?: readonly ModuleImport[];
  /** Providers the factory receives, in order. */
  readonly inject?: TDependencies;
  /** Builds the server factory from the injected providers. */
  readonly useFactory: (...dependencies: TokenMap<TDependencies>) => McpServerFactory;
  /**
   * The authentication decision.
   *
   * A `false` answer or a thrown error is a `401`. When this is absent the
   * configuration must set `allowUnauthenticated: true`; the boot refuses
   * otherwise.
   */
  readonly authorize?: McpAuthorize;
  /**
   * Whether the endpoint keeps a session per client.
   *
   * Defaults to `"stateless"`, which builds a server per request and works in
   * serverless hosts. `"stateful"` keeps a transport per `mcp-session-id` and
   * closes them when the application closes.
   */
  readonly sessions?: "stateless" | "stateful";
  /**
   * Whether JSON-RPC answers use a JSON body instead of an SSE stream.
   *
   * Defaults to `false`, which is the SDK's own default.
   */
  readonly jsonResponse?: boolean;
  /** The record the configuration's schema validates, instead of `process.env`. */
  readonly source?: Readonly<Record<string, unknown>>;
  /** The module's stable identity; defaults to `"mcp"`. */
  readonly key?: string;
}
