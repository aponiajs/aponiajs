# @aponiajs/mcp — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The Nest-style Model Context Protocol endpoint. Decorators are metadata-only and
live in `@aponiajs/common`; this package re-exports them and owns discovery,
execution, transports, and the HTTP controller.

| Domain        | Owns                                                                                |
| ------------- | ----------------------------------------------------------------------------------- |
| `module/`     | `McpModule.forRoot`, `forRootAsync`, options, and the generated HTTP controller     |
| `discovery/`  | Walking the container graph, reading decorator metadata, and refusing invalid plans |
| `execution/`  | `McpExecutionContext`, `McpContext`, and the guard/interceptor/pipe/filter pipeline |
| `transport/`  | `createMcpHandler` wiring, Origin/Host/body gate, and the stdio entrypoints         |
| `interfaces/` | the module, tool, resource, prompt, and context contracts                           |

`src/index.ts` is the only public barrel.

## Invariants

- **The SDK is the only protocol implementation.** No JSON-RPC or tool registry
  lives here. `@modelcontextprotocol/server` v2 speaks the wire.
- **Discovery is a boot decision.** A duplicate tool or prompt name, an invalid
  name, or an `include` entry outside the graph throws before the endpoint
  serves a request.
- **One SDK server per request and per stdio connection.** Never cache a server
  across requests; stateless serving is the contract.
- **Enhancers are explicit.** Module options, class decorators, and method
  decorators run in that order. HTTP globals from `AponiaFactory.create` are
  not inherited automatically.
- **The module is runtime-neutral.** The endpoint is a controller over the
  SDK's fetch handler, built from the boot's container reference. `readMcpRuntime`
  answers from that container, which is what the stdio entry reads.
- **The endpoint is a tool-dispatch surface.** Keep the Origin allowlist and the
  Host check in place; `path: false` disables HTTP deliberately. A stopping
  application closes the transport once through `McpRuntimeShutdown`.

## Tests

`packages/mcp/src/**/*.spec.ts` drives the endpoint through Elysia, Hono, H3, and
an in-memory stdio transport. `packages/mcp/test/*.conformance.ts` pins the
public types.
