import type { McpToolCallResult } from "../protocol/protocol.types.ts";
import type { McpToolDefinition, McpToolDescriptor } from "./tool.types.ts";

/**
 * Registry maintaining registered MCP tools and dispatching execution.
 */
export class McpToolRegistry {
  readonly #tools = new Map<string, McpToolDefinition<any>>();

  /**
   * Registers a tool definition in the registry.
   */
  register(tool: McpToolDefinition<any>): void {
    this.#tools.set(tool.name, tool);
  }

  /**
   * Unregisters a tool definition by name.
   */
  unregister(name: string): boolean {
    return this.#tools.delete(name);
  }

  /**
   * Retrieves a tool definition by name.
   */
  get(name: string): McpToolDefinition<any> | undefined {
    return this.#tools.get(name);
  }

  /**
   * Lists descriptors of all registered tools for `tools/list`.
   */
  list(): readonly McpToolDescriptor[] {
    return Array.from(this.#tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  /**
   * Invokes a tool by name with arguments.
   */
  async execute(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const tool = this.#tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" is not registered.`);
    }

    return await tool.handler(args);
  }
}
