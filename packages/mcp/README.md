# `@aponiajs/mcp`

Model Context Protocol server and tool registry for AponiaJS.

## Features

- **Version negotiation**: answers the handshake versions `2024-11-05`, `2025-03-26`, `2025-06-18`, and `2025-11-25`, echoing the version a supported client asks for.
- **Stateless discovery**: answers `server/discover` with the supported versions, capabilities, and server info, so a client that follows the `2026-07-28` revision can choose a version before its first request.
- **Centralized tool registry**: register and invoke tools with JSON Schema input and optional output schemas.
- **Resources and prompts**: publish readable resources and reusable prompt templates beside the tools.
- **Structured results**: a tool may answer `structuredContent` beside its text content; `tools/list` publishes each tool's `outputSchema` when it declares one.
- **Stateless HTTP transport**: a readiness document on `GET`, JSON-RPC 2.0 on `POST`, and header/meta version agreement checks.

## Installation

```bash
bun add @aponiajs/mcp
```

## Use it in an Aponia application

For development introspection, `@aponiajs/devtools` mounts the MCP server on the
application's own route table at `/__devtools/mcp`:

```ts
import { Module } from "@aponiajs/common";
import { DevtoolsModule } from "@aponiajs/devtools";

@Module({ imports: [DevtoolsModule.register({ enabled: true })] })
export class AppModule {}
```

A production endpoint builds its own server and mounts the stateless handler
through the module graph:

```ts
import { Module } from "@aponiajs/common";
import { PluginModule } from "@aponiajs/platform-elysia";
import { createStatelessHttpHandler } from "@aponiajs/mcp";
import { Elysia } from "elysia";
import { server } from "./mcp-server.ts";

const handler = createStatelessHttpHandler(server);
const endpoint = PluginModule.register(
  new Elysia({ name: "mcp-endpoint" }).all("/mcp", ({ request }) => handler(request)),
  { key: "mcp" },
);

@Module({ imports: [endpoint] })
export class AppModule {}
```

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Embedding the server

The server API is what the endpoint above mounts. Build it with the tools,
resources, and prompts the application publishes:

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
    outputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
    handler: (args) => ({
      content: [{ type: "text", text: `Pong: ${args.message ?? "ok"}` }],
      structuredContent: { message: args.message ?? "ok" },
    }),
  }),
);
```

## Version negotiation

`initialize` echoes a version the server supports and falls back to `2024-11-05`
for a request that names none or names one it does not implement.
`McpServerOptions.protocolVersions` narrows or widens that list for one server.
`protocolVersions` on the instance and on the readiness document states the
same list.

The package does not claim full `2026-07-28` compliance: discovery is
implemented, while multi round-trip requests, cache hints, and the rest of that
revision are not.

## Limits

The transport adapters are stateless. Sessionful transports, server push, and
the `2026-07-28` multi round-trip flow are not implemented; `server/discover`
exists so a stateless client can still negotiate a version.
