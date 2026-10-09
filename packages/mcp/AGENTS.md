# @aponiajs/mcp — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The standardized Model Context Protocol (MCP) implementation adhering to the official
specification `2024-11-05`. It provides the centralized MCP server, standard tool
registry, JSON-RPC 2.0 dispatching engine, and stateless HTTP / SSE transport adapters
for AponiaJS applications and development tools.

| Domain      | Owns                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `protocol/` | Protocol constants (`MCP_PROTOCOL_VERSION = "2024-11-05"`), JSON-RPC 2.0 schemas, types, and errors |
| `server/`   | `McpServer`, request dispatching (`handleJsonRpc`), lifecycle events, and server options            |
| `tools/`    | `McpToolRegistry`, `defineMcpTool`, parameter validation schemas, and execution handlers            |

`src/index.ts` is the only public barrel. Keep `*.types.ts` colocated with the
runtime boundary it describes.

## Invariants

- Strictly implements the official Model Context Protocol (MCP) standard `2024-11-05`.
- Complies with JSON-RPC 2.0 specification for requests, responses, errors, and notifications.
- All errors emitted across the wire must follow the standardized JSON-RPC 2.0 error contract
  (`ParseError: -32700`, `InvalidRequest: -32600`, `MethodNotFound: -32601`,
  `InvalidParams: -32602`, `InternalError: -32603`).
- Return frozen public descriptors and tool definitions; contracts remain immutable.
- Tool arguments and returns remain type-safe and validated before handler invocation.
- Do not introduce runtime dependencies on Node-only or external heavy frameworks; keep it pure Bun/TypeScript and lightweight.

## Tests

Bun tests live in `packages/mcp/tests/*.test.ts`, and Vite+ conformance tests live in
`packages/mcp/tests-vp/*.conformance.ts`.
