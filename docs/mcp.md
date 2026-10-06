# Model Context Protocol (MCP)

AponiaJS provides first-class support for the Model Context Protocol (MCP) specification (`2024-11-05`). The framework decouples its protocol engine into the dedicated core package `@aponiajs/mcp` and integrates it into `@aponiajs/devtools` to expose running application state to AI agents, IDE assistants, and external LLM workflows.

## Overview

The Model Context Protocol standardizes how applications provide context, tools, and execution capabilities to LLM clients using JSON-RPC 2.0. In AponiaJS:

- `@aponiajs/mcp` contains the platform-neutral, lightweight MCP server, JSON-RPC 2.0 protocol engine, and tool registry.
- `@aponiajs/devtools` embeds this MCP server directly into running applications at `/__devtools/mcp`, exposing real-time introspection tools.

## Protocol Specification (2024-11-05)

### Wire Format

All communication follows JSON-RPC 2.0 over stateless HTTP.

#### 1. Discovery Handshake (`GET /__devtools/mcp`)

Clients send an HTTP `GET` request to verify availability and protocol version:

```http
GET /__devtools/mcp HTTP/1.1
```

Response:

```json
{
  "status": "ready",
  "protocol": "mcp",
  "version": "2024-11-05"
}
```

#### 2. Protocol Initialization (`initialize`)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "cursor",
      "version": "0.45.0"
    }
  }
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
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

#### 3. List Tools (`tools/list`)

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "inspect_application_graph",
        "description": "Inspect the complete Dependency Injection graph of the application...",
        "inputSchema": {
          "type": "object",
          "properties": {}
        }
      }
    ]
  }
}
```

#### 4. Tool Execution (`tools/call`)

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "inspect_route_pipeline",
    "arguments": {
      "method": "GET",
      "path": "/users/:id"
    }
  }
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{ ...route pipeline stages... }"
      }
    ]
  }
}
```

## Standard Error Codes

Wire-level errors conform to JSON-RPC 2.0 error definitions:

| Code     | Meaning          | Description                                    |
| -------- | ---------------- | ---------------------------------------------- |
| `-32700` | Parse error      | Invalid JSON received by the server.           |
| `-32600` | Invalid request  | The JSON sent is not a valid Request object.   |
| `-32601` | Method not found | The method does not exist or is not available. |
| `-32602` | Invalid params   | Invalid method parameters.                     |
| `-32603` | Internal error   | Internal error occurred during processing.     |

## Embedded Devtools Tools

When devtools are enabled, `@aponiajs/devtools` provides six standard MCP tools:

1. `inspect_application_graph`: Complete module, provider, scope, and dependency graph.
2. `inspect_route_pipeline`: Complete execution pipeline stages (middleware, guards, interceptors, pipes, handler, filters).
3. `get_source_code`: Extracts source code for controllers, services, handlers, or guards.
4. `query_recent_requests`: Recent HTTP requests with latency, headers, status, and parsed bodies.
5. `read_application_logs`: Live application logs filtered by log level and offset cursor.
6. `inspect_store_state`: In-memory state snapshots of the application store.
