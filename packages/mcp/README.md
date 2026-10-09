# `@aponiajs/mcp`

Standardized Model Context Protocol (MCP `2024-11-05`) server and tool registry for AponiaJS.

## Features

- **Official MCP 2024-11-05 Compliance**: Fully aligned with the official Model Context Protocol JSON-RPC 2.0 standard.
- **Centralized Tool Registry**: Register and invoke tools with standard input validation schemas and structured output payloads.
- **Protocol Dispatcher**: Clean separation between protocol parsing, lifecycle negotiation, and tool execution.
- **Lightweight Transports**: Built-in HTTP and JSON-RPC dispatchers without heavy runtime dependencies.

## Installation

```bash
bun add @aponiajs/mcp
```

## Quick Start

```ts
import { McpServer, defineMcpTool } from "@aponiajs/mcp";

const server = new McpServer({
  name: "my-app-mcp",
  version: "1.0.0",
});

server.registerTool(
  defineMcpTool({
    name: "ping",
    description: "Ping the application",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
      },
    },
    handler: async (args) => ({
      content: [{ type: "text", text: `Pong: ${args.message ?? "ok"}` }],
    }),
  }),
);
```
