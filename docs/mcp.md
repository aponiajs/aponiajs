# Model Context Protocol (MCP)

AponiaJS provides first-class support for the Model Context Protocol (MCP). The
framework decouples its protocol engine into the dedicated core package
`@aponiajs/mcp` and integrates it into `@aponiajs/devtools` to expose running
application state to AI agents, IDE assistants, and external LLM workflows.

## Overview

The Model Context Protocol standardizes how applications provide context, tools,
and execution capabilities to LLM clients using JSON-RPC 2.0. In AponiaJS:

- `@aponiajs/mcp` contains the platform-neutral MCP server, JSON-RPC 2.0
  protocol engine, and tool registry.
- `@aponiajs/devtools` embeds this MCP server directly into running
  applications at `/__devtools/mcp`, exposing real-time introspection tools.

## Using MCP in an Aponia application

`DevtoolsModule` is the shortest path for a development surface:

```ts
import { Module } from "@aponiajs/common";
import { DevtoolsModule } from "@aponiajs/devtools";

@Module({ imports: [DevtoolsModule.register({ enabled: true })] })
export class AppModule {}
```

A production endpoint declares the server in source and mounts it through the
module graph:

```ts
import { Module } from "@aponiajs/common";
import { PluginModule, AponiaFactory } from "@aponiajs/platform-elysia";
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

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

The server is built with `new McpServer(...)` and its tools are registered in
`mcp-server.ts`. The package's own server API is described below; the plugin
above is the framework integration.

## Protocol versions

The server answers the handshake versions `2024-11-05`, `2025-03-26`,
`2025-06-18`, and `2025-11-25`:

- A client that asks for one of them in `initialize` is answered with that same
  version.
- A client that asks for anything else, or states no version, is answered with
  `2024-11-05`, which is the version the package shipped against.
- `MCP_PROTOCOL_VERSIONS` lists what this build supports, and
  `McpServerOptions.protocolVersions` narrows or widens the list for one server.

The `2026-07-28` revision removes the handshake in favour of per-request state.
The server answers that revision's `server/discover` request so a stateless
client can learn the supported versions and choose one, but it does not claim
full `2026-07-28` compliance: multi round-trip requests, cache hints, and the
rest of that revision are not implemented.

### Wire format

All communication follows JSON-RPC 2.0 over stateless HTTP.

#### 1. Readiness (`GET /__devtools/mcp`)

```http
GET /__devtools/mcp HTTP/1.1
```

```json
{
  "status": "ready",
  "protocol": "mcp",
  "version": "2024-11-05",
  "protocolVersions": ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]
}
```

#### 2. Protocol initialization (`initialize`)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {
      "name": "cursor",
      "version": "0.45.0"
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "aponia-devtools",
      "version": "1.0.0"
    }
  }
}
```

#### 3. Stateless discovery (`server/discover`)

A client that follows the `2026-07-28` revision states its version and
capabilities on the request instead of a handshake. Both are required:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "server/discover",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2025-11-25",
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "protocolVersions": ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"],
    "capabilities": { "tools": {} },
    "serverInfo": { "name": "aponia-devtools", "version": "1.0.0" }
  }
}
```

An unsupported version, a missing `_meta`, or missing client capabilities is an
invalid-params error that names the problem.

#### 4. List tools (`tools/list`)

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/list"
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "tools": [
      {
        "name": "inspect_application_graph",
        "description": "Inspect the complete Dependency Injection graph of the application...",
        "inputSchema": { "type": "object", "properties": {} },
        "outputSchema": {
          "type": "object",
          "properties": { "modules": { "type": "array" } }
        }
      }
    ]
  }
}
```

`outputSchema` is optional. A tool that declares one should answer a JSON object
in `structuredContent`; a tool that answers an array or a scalar states it in
the text content only, because the specification requires `structuredContent`
to be an object when it is present.

#### 5. Tool execution (`tools/call`)

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "inspect_route_pipeline",
    "arguments": { "method": "GET", "path": "/users/:id" }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [{ "type": "text", "text": "{ ...route pipeline stages... }" }],
    "structuredContent": { "stages": ["guard", "handler"] }
  }
}
```

## Resources and prompts

Register a resource when a client should read a document, a configuration
snapshot, or any other body by URI:

```ts
server.registerResource(
  defineMcpResource({
    uri: "aponia://deployment",
    name: "Deployment",
    mimeType: "application/json",
    read: () => [{ uri: "aponia://deployment", mimeType: "application/json", text: "{}" }],
  }),
);
```

`resources/list` publishes the descriptor and `resources/read` passes the uri to
the handler. Register a prompt when a client should fill a template with named
arguments:

```ts
server.registerPrompt(
  defineMcpPrompt({
    name: "review-change",
    arguments: [{ name: "diff", required: true }],
    get: (arguments_) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: `Review this change:\n${arguments_.diff}` },
        },
      ],
    }),
  }),
);
```

The `resources` and `prompts` capabilities are advertised only when the server
has an entry for them. An unknown uri or prompt name is an invalid-params error;
a handler failure answers a generic internal error without its message.

## Standard error codes

Wire-level errors conform to JSON-RPC 2.0 error definitions:

| Code     | Meaning          | Description                                    |
| -------- | ---------------- | ---------------------------------------------- |
| `-32700` | Parse error      | Invalid JSON received by the server.           |
| `-32600` | Invalid request  | The JSON sent is not a valid Request object.   |
| `-32601` | Method not found | The method does not exist or is not available. |
| `-32602` | Invalid params   | Invalid method parameters.                     |
| `-32603` | Internal error   | Internal error occurred during processing.     |

## HTTP protocol header

A stateless request repeats its version in the `Mcp-Protocol-Version` header.
The handler refuses a version the server does not support, and refuses a request
whose header and `params._meta` state different versions.

## Embedded devtools tools

When devtools are enabled, `@aponiajs/devtools` provides six standard MCP tools:

1. `inspect_application_graph`: Complete module, provider, scope, and dependency graph.
2. `inspect_route_pipeline`: Complete execution pipeline stages (middleware, guards, interceptors, pipes, handler, filters).
3. `get_source_code`: Extracts source code for controllers, services, handlers, or guards.
4. `query_recent_requests`: Recent HTTP requests with latency, headers, status, and parsed bodies.
5. `read_application_logs`: Live application logs filtered by log level and offset cursor.
6. `inspect_store_state`: In-memory state snapshots of the application store.
