import {
  JSONRPC_ERROR_CODES,
  MCP_CLIENT_CAPABILITIES_META_KEY,
  MCP_DISCOVER_METHOD,
  MCP_PROTOCOL_META_KEY,
  MCP_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
} from "../protocol/protocol.constants.ts";
import type {
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  McpGetPromptResult,
  McpDiscoverParams,
  McpDiscoverResult,
  McpInitializeParams,
  McpInitializeResult,
  McpReadResourceResult,
} from "../protocol/protocol.types.ts";
import { McpPromptRegistry } from "../prompts/prompt-registry.ts";
import type { McpPromptDefinition } from "../prompts/prompt.types.ts";
import { McpResourceRegistry } from "../resources/resource-registry.ts";
import type { McpResourceDefinition } from "../resources/resource.types.ts";
import { McpToolRegistry } from "../tools/tool-registry.ts";
import type { McpToolDefinition } from "../tools/tool.types.ts";
import type { McpServerOptions } from "./mcp-server.types.ts";

/**
 * Model Context Protocol server.
 *
 * It answers the handshake versions listed in `MCP_PROTOCOL_VERSIONS`, echoing
 * the version a supported client asks for, and answers `server/discover` so a
 * stateless client can choose a version before its first request.
 */
export class McpServer {
  readonly #options: McpServerOptions;
  readonly #registry = new McpToolRegistry();
  readonly #resources = new McpResourceRegistry();
  readonly #prompts = new McpPromptRegistry();
  readonly #protocolVersions: readonly string[];
  readonly #fallbackProtocolVersion: string;

  constructor(options: McpServerOptions) {
    this.#options = Object.freeze({ ...options });
    const versions = options.protocolVersions ?? MCP_PROTOCOL_VERSIONS;
    if (
      versions.length === 0 ||
      versions.some((version) => typeof version !== "string" || version.trim() === "")
    ) {
      throw new TypeError("McpServer protocolVersions must be a non-empty list of strings.");
    }
    this.#protocolVersions = Object.freeze([...versions]);
    this.#fallbackProtocolVersion = this.#protocolVersions.includes(MCP_PROTOCOL_VERSION)
      ? MCP_PROTOCOL_VERSION
      : (this.#protocolVersions.at(-1) as string);
  }

  /** The handshake versions this server answers. */
  get protocolVersions(): readonly string[] {
    return this.#protocolVersions;
  }

  /**
   * Access to the underlying tool registry.
   */
  get tools(): McpToolRegistry {
    return this.#registry;
  }

  /** Access to the underlying resource registry. */
  get resources(): McpResourceRegistry {
    return this.#resources;
  }

  /** Access to the underlying prompt registry. */
  get prompts(): McpPromptRegistry {
    return this.#prompts;
  }

  /**
   * Registers a tool on the server.
   */
  registerTool(tool: McpToolDefinition<any>): this {
    this.#registry.register(tool);
    return this;
  }

  /** Registers a resource on the server. */
  registerResource(resource: McpResourceDefinition): this {
    this.#resources.register(resource);
    return this;
  }

  /** Registers a prompt on the server. */
  registerPrompt(prompt: McpPromptDefinition): this {
    this.#prompts.register(prompt);
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
        case MCP_DISCOVER_METHOD: {
          return this.#handleDiscover(id, req.params as McpDiscoverParams | undefined);
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
        case "resources/list": {
          return {
            jsonrpc: "2.0",
            id,
            result: { resources: this.#resources.list() },
          };
        }
        case "resources/read": {
          return await this.#handleResourceRead(id, req.params);
        }
        case "prompts/list": {
          return {
            jsonrpc: "2.0",
            id,
            result: { prompts: this.#prompts.list() },
          };
        }
        case "prompts/get": {
          return await this.#handlePromptGet(id, req.params);
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
    params?: McpInitializeParams,
  ): JsonRpcResponse<McpInitializeResult> {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: this.#negotiate(params?.protocolVersion),
        capabilities: {
          tools: {},
          ...(this.#resources.size > 0 ? { resources: {} } : {}),
          ...(this.#prompts.size > 0 ? { prompts: {} } : {}),
        },
        serverInfo: {
          name: this.#options.name,
          version: this.#options.version,
        },
      },
    };
  }

  #negotiate(version: unknown): string {
    return typeof version === "string" && this.#protocolVersions.includes(version)
      ? version
      : this.#fallbackProtocolVersion;
  }

  #handleDiscover(
    id: JsonRpcId,
    params: McpDiscoverParams | undefined,
  ): JsonRpcResponse<McpDiscoverResult> {
    if (typeof params !== "object" || params === null) {
      return this.#error(
        id,
        JSONRPC_ERROR_CODES.INVALID_PARAMS,
        "Invalid params for server/discover",
      );
    }
    const meta = params._meta;
    if (typeof meta !== "object" || meta === null) {
      return this.#error(
        id,
        JSONRPC_ERROR_CODES.INVALID_PARAMS,
        "server/discover requires the request meta",
      );
    }
    if (meta[MCP_CLIENT_CAPABILITIES_META_KEY] === undefined) {
      return this.#error(
        id,
        JSONRPC_ERROR_CODES.INVALID_PARAMS,
        "server/discover requires client capabilities",
      );
    }
    const requested = meta[MCP_PROTOCOL_META_KEY];
    if (
      typeof requested === "string" &&
      requested !== "" &&
      !this.#protocolVersions.includes(requested)
    ) {
      return this.#error(
        id,
        JSONRPC_ERROR_CODES.INVALID_PARAMS,
        `Unsupported protocol version ${requested}`,
      );
    }
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersions: this.#protocolVersions,
        capabilities: {
          tools: {},
          ...(this.#resources.size > 0 ? { resources: {} } : {}),
          ...(this.#prompts.size > 0 ? { prompts: {} } : {}),
        },
        serverInfo: { name: this.#options.name, version: this.#options.version },
      },
    };
  }

  async #handleResourceRead(id: JsonRpcId, params: unknown): Promise<JsonRpcResponse> {
    if (typeof params !== "object" || params === null) {
      return this.#error(
        id,
        JSONRPC_ERROR_CODES.INVALID_PARAMS,
        "Invalid params for resources/read",
      );
    }
    const { uri } = params as { readonly uri?: unknown };
    if (typeof uri !== "string" || uri === "") {
      return this.#error(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, "Resource uri is required");
    }
    const resource = this.#resources.get(uri);
    if (resource === undefined) {
      return this.#error(
        id,
        JSONRPC_ERROR_CODES.INVALID_PARAMS,
        `Resource "${uri}" is not registered`,
      );
    }
    try {
      const contents = await resource.read();
      return { jsonrpc: "2.0", id, result: { contents } satisfies McpReadResourceResult };
    } catch {
      return this.#error(id, JSONRPC_ERROR_CODES.INTERNAL_ERROR, "The resource could not be read");
    }
  }

  async #handlePromptGet(id: JsonRpcId, params: unknown): Promise<JsonRpcResponse> {
    if (typeof params !== "object" || params === null) {
      return this.#error(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, "Invalid params for prompts/get");
    }
    const { name, arguments: promptArguments } = params as {
      readonly name?: unknown;
      readonly arguments?: unknown;
    };
    if (typeof name !== "string" || name === "") {
      return this.#error(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, "Prompt name is required");
    }
    const prompt = this.#prompts.get(name);
    if (prompt === undefined) {
      return this.#error(
        id,
        JSONRPC_ERROR_CODES.INVALID_PARAMS,
        `Prompt "${name}" is not registered`,
      );
    }
    if (
      promptArguments !== undefined &&
      (typeof promptArguments !== "object" || promptArguments === null)
    ) {
      return this.#error(
        id,
        JSONRPC_ERROR_CODES.INVALID_PARAMS,
        "Prompt arguments must be an object",
      );
    }
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(promptArguments ?? {})) {
      if (typeof value !== "string") {
        return this.#error(
          id,
          JSONRPC_ERROR_CODES.INVALID_PARAMS,
          `Prompt argument "${key}" must be a string`,
        );
      }
      values[key] = value;
    }
    try {
      const result = await prompt.get(values);
      return { jsonrpc: "2.0", id, result: result satisfies McpGetPromptResult };
    } catch {
      return this.#error(id, JSONRPC_ERROR_CODES.INTERNAL_ERROR, "The prompt could not be built");
    }
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
