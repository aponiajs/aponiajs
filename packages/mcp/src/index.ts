/**
 * The Model Context Protocol endpoint for an Aponia application.
 *
 * The package mounts the official `@modelcontextprotocol/sdk` server through
 * the framework's plugin seam, so a tool surface is a module registration
 * rather than a transport an application starts itself.
 */

export { McpModule } from "./module/mcp-module.ts";
export type {
  McpAuthorize,
  McpModuleOptions,
  McpServerFactory,
} from "./module/mcp-module.types.ts";
export type { McpConfiguration } from "./policy/mcp-policy.types.ts";
