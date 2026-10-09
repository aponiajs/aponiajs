import { JSONRPC_ERROR_CODES, MCP_PROTOCOL_VERSION } from "../protocol/protocol.constants.ts";
import type {
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  McpInitializeParams,
  McpInitializeResult,
} from "../protocol/protocol.types.ts";
import { McpToolRegistry } from "../tools/tool-registry.ts";
import type { McpToolDefinition } from "../tools/tool.types.ts";
import type { McpServerOptions } from "./mcp-server.types.ts";

/**
 * Standard Model Context Protocol (MCP 2024-11-05) Server.
 */
export class McpServer {
  readonly #options: McpServerOptions;
  readonly #registry = new McpToolRegistry();

  constructor(options: McpServerOptions) {
    this.#options = Object.freeze({ ...options });
  }

  /**
   * Access to the underlying tool registry.
   */
  get tools(): McpToolRegistry {
    return this.#registry;
  }

  /**
   * Registers a tool on the server.
   */
  registerTool(tool: McpToolDefinition<any>): this {
    this.#registry.register(tool);
    return this;
  }

  /**
   * Dispatches a JSON-RPC 2.0 message against the server.
   */
  async handleMessage(message: unknown): Promise<JsonRpcResponse | null> {
    if (typeof message !== "object" || message === null) {
      return this.#error(null, JSONRPC_ERROR_CODES.INVALID_REQUEST, "Invalid Request");
    }

    const req = message as Partial<JsonRpcRequest>;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
      return this.#error(
        req.id ?? null,
        JSONRPC_ERROR_CODES.INVALID_REQUEST,
        "Invalid JSON-RPC 2.0 Request",
      );
    }

    const id = req.id ?? null;

    try {
      switch (req.method) {
        case "initialize": {
          return this.#handleInitialize(id, req.params as McpInitializeParams | undefined);
        }
        case "notifications/initialized": {
          // Client acknowledgement; notifications return no JSON-RPC response
          return null;
        }
        case "ping": {
          return { jsonrpc: "2.0", id, result: {} };
        }
        case "tools/list": {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              tools: this.#registry.list(),
            },
          };
        }
        case "tools/call": {
          return await this.#handleToolsCall(id, req.params);
        }
        default: {
          return this.#error(
            id,
            JSONRPC_ERROR_CODES.METHOD_NOT_FOUND,
            `Method "${req.method}" not found`,
          );
        }
      }
    } catch (error: any) {
      return this.#error(
        id,
        JSONRPC_ERROR_CODES.INTERNAL_ERROR,
        error?.message ?? "Internal MCP Server Error",
      );
    }
  }

  #handleInitialize(
    id: JsonRpcId,
    _params?: McpInitializeParams,
  ): JsonRpcResponse<McpInitializeResult> {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: this.#options.name,
          version: this.#options.version,
        },
      },
    };
  }

  async #handleToolsCall(id: JsonRpcId, params: unknown): Promise<JsonRpcResponse> {
    if (typeof params !== "object" || params === null) {
      return this.#error(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, "Invalid params for tools/call");
    }

    const { name, arguments: toolArgs } = params as { name?: unknown; arguments?: unknown };
    if (typeof name !== "string") {
      return this.#error(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, "Tool name is required");
    }

    const tool = this.#registry.get(name);
    if (!tool) {
      return this.#error(
        id,
        JSONRPC_ERROR_CODES.INVALID_PARAMS,
        `Tool "${name}" is not registered`,
      );
    }

    try {
      const args = (typeof toolArgs === "object" && toolArgs !== null ? toolArgs : {}) as Record<
        string,
        unknown
      >;
      const result = await tool.handler(args);
      return {
        jsonrpc: "2.0",
        id,
        result,
      };
    } catch (err: any) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Tool error: ${err?.message ?? String(err)}` }],
          isError: true,
        },
      };
    }
  }

  #error(id: JsonRpcId, code: number, message: string): JsonRpcErrorResponse {
    return {
      jsonrpc: "2.0",
      id,
      error: { code, message },
    };
  }
}
