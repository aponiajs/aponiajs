/** The MCP protocol version a client that states none receives. */
export const agentMcpProtocolVersion = "2024-11-05";

/** The newest handshake version this CLI surface speaks. */
export const agentMcpLatestProtocolVersion = "2025-11-25";

/** Every handshake version this CLI surface answers. */
export const agentMcpProtocolVersions = Object.freeze([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
] as const);

/** The stateless discovery method a multi-version client asks first. */
const discoverMethod = "server/discover";

/** The `_meta` key a stateless request states its protocol version under. */
const protocolMetaKey = "io.modelcontextprotocol/protocolVersion";

/** The `_meta` key a stateless request states its client capabilities under. */
const clientCapabilitiesMetaKey = "io.modelcontextprotocol/clientCapabilities";

/** One tool the agent MCP server registers. */
export interface AgentMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<{
    readonly type: "object";
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
  }>;
  readonly handler: (args: Record<string, unknown>) => unknown;
}

/** Freezes one tool declaration. */
export function defineAgentTool<TArgs extends Record<string, unknown> = Record<string, unknown>>(
  tool: Omit<AgentMcpTool, "handler"> & { readonly handler: (args: TArgs) => unknown },
): AgentMcpTool {
  return Object.freeze({
    name: tool.name,
    description: tool.description,
    inputSchema: Object.freeze({ ...tool.inputSchema }),
    handler: (args: Record<string, unknown>) => tool.handler(args as TArgs),
  });
}

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

/** A tiny MCP server for the CLI's read-only tool surface. */
export class AgentMcpServer {
  readonly #options: Readonly<{ readonly name: string; readonly version: string }>;
  readonly #tools = new Map<string, AgentMcpTool>();

  constructor(options: { readonly name: string; readonly version: string }) {
    this.#options = Object.freeze({ ...options });
  }

  /** Registers one tool; a duplicate name is a programming error. */
  registerTool(tool: AgentMcpTool): this {
    if (this.#tools.has(tool.name)) {
      throw new Error(`MCP tool "${tool.name}" is already registered.`);
    }
    this.#tools.set(tool.name, tool);
    return this;
  }

  /** Dispatches one JSON-RPC message. */
  async handleMessage(message: unknown): Promise<JsonRpcResponse | null> {
    if (typeof message !== "object" || message === null) {
      return this.#error(null, -32600, "Invalid Request");
    }
    const request = message as {
      readonly jsonrpc?: unknown;
      readonly method?: unknown;
      readonly id?: unknown;
      readonly params?: unknown;
    };
    if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
      return this.#error(idOf(request.id), -32600, "Invalid Request");
    }
    const id = idOf(request.id);

    switch (request.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: negotiateVersion(request.params),
            capabilities: { tools: {} },
            serverInfo: this.#options,
          },
        };
      case discoverMethod:
        return this.#discover(id, request.params);
      case "notifications/initialized":
        return null;
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: [...this.#tools.values()].map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          },
        };
      case "tools/call":
        return await this.#callTool(id, request.params);
      default:
        return this.#error(id, -32601, `Method "${request.method}" not found`);
    }
  }

  #discover(id: string | number | null, params: unknown): JsonRpcResponse {
    if (typeof params !== "object" || params === null) {
      return this.#error(id, -32602, "Invalid params for server/discover");
    }
    const meta = (params as { readonly _meta?: unknown })._meta;
    if (typeof meta !== "object" || meta === null) {
      return this.#error(id, -32602, "server/discover requires the request meta");
    }
    const record = meta as Record<string, unknown>;
    if (record[clientCapabilitiesMetaKey] === undefined) {
      return this.#error(id, -32602, "server/discover requires client capabilities");
    }
    const requested = record[protocolMetaKey];
    if (
      typeof requested === "string" &&
      requested !== "" &&
      !agentMcpProtocolVersions.includes(requested as (typeof agentMcpProtocolVersions)[number])
    ) {
      return this.#error(id, -32602, `Unsupported protocol version ${requested}`);
    }
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersions: agentMcpProtocolVersions,
        capabilities: { tools: {} },
        serverInfo: this.#options,
      },
    };
  }

  async #callTool(id: string | number | null, params: unknown): Promise<JsonRpcResponse> {
    if (typeof params !== "object" || params === null) {
      return this.#error(id, -32602, "Invalid params for tools/call");
    }
    const { name, arguments: arguments_ } = params as {
      readonly name?: unknown;
      readonly arguments?: unknown;
    };
    if (typeof name !== "string") {
      return this.#error(id, -32602, "Tool name is required");
    }
    const tool = this.#tools.get(name);
    if (tool === undefined) {
      return this.#error(id, -32602, `Tool "${name}" is not registered`);
    }
    try {
      const args = (
        typeof arguments_ === "object" && arguments_ !== null ? arguments_ : {}
      ) as Record<string, unknown>;
      return { jsonrpc: "2.0", id, result: await tool.handler(args) };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: `Tool error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        },
      };
    }
  }

  #error(id: string | number | null, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
}

function negotiateVersion(params: unknown): string {
  if (typeof params !== "object" || params === null) {
    return agentMcpProtocolVersion;
  }
  const requested = (params as { readonly protocolVersion?: unknown }).protocolVersion;
  return typeof requested === "string" &&
    agentMcpProtocolVersions.includes(requested as (typeof agentMcpProtocolVersions)[number])
    ? requested
    : agentMcpProtocolVersion;
}

function idOf(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}
