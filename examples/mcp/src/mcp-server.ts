import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppService } from "./app.service.ts";

/**
 * Builds one MCP server.
 *
 * The endpoint calls this once per request in stateless mode, so every server
 * is a fresh one with the same tools. The application service is closed over,
 * which is what lets a tool answer from application state.
 */
export function buildMcpServer(app: AppService): McpServer {
  const server = new McpServer({ name: "aponia-mcp-example", version: "1.0.0" });

  server.registerTool(
    "describe_application",
    {
      description: "Describe the running application",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: app.describe() }],
    }),
  );

  server.registerTool(
    "add",
    {
      description: "Add two numbers",
      inputSchema: { a: z.number(), b: z.number() },
    },
    async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    }),
  );

  return server;
}
