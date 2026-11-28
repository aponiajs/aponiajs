/**
 * The Nest-style Model Context Protocol endpoint for an Aponia application.
 *
 * Tools, resources, and prompts are methods of providers, decorated with the
 * decorators this barrel re-exports. The module discovers them at mount time
 * and serves them from the official `@modelcontextprotocol/server` SDK.
 */

export { MCP_OPTIONS, McpModule } from "./module/mcp.module.ts";
export type {
  McpHttpLegacy,
  McpHttpOptions,
  McpModuleAsyncOptions,
  McpModuleOptions,
  McpModuleTopLevel,
  McpResponseMode,
  McpServerMetadata,
  McpStdioLegacy,
  McpStdioOptions,
} from "./interfaces/mcp-module.interface.ts";
export { McpExecutionContext } from "./execution/mcp-execution-context.ts";
export type { McpContext } from "./interfaces/mcp-context.interface.ts";
export { listenMcpStdio, serveMcpStdio } from "./transport/mcp-stdio.ts";
export type { McpStdioServerOptions } from "./transport/mcp-stdio.ts";

export { Prompt, Resource, ResourceTemplate, Tool } from "@aponiajs/common";
export type {
  McpPrimitiveKind,
  McpPrimitiveMetadata,
  McpPromptOptions,
  McpResourceOptions,
  McpResourceTemplateOptions,
  McpToolOptions,
} from "@aponiajs/common";
