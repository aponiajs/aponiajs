# @aponiajs/mcp — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The Model Context Protocol server, its JSON-RPC 2.0 protocol engine, version
negotiation, `server/discover`, the tool registry, and the stateless HTTP
transport. It serves AponiaJS applications and development tools.

| Domain       | Owns                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------- |
| `protocol/`  | Version constants, `_meta` keys, the header name, JSON-RPC 2.0 schemas, and wire types    |
| `server/`    | `McpServer`, JSON-RPC dispatch, negotiation, discovery, HTTP handling, and server options |
| `tools/`     | `McpToolRegistry`, `defineMcpTool`, and input/output schema contracts                     |
| `resources/` | `McpResourceRegistry`, `defineMcpResource`, and the resource read contract                |
| `prompts/`   | `McpPromptRegistry`, `defineMcpPrompt`, and the prompt argument/message contract          |

`src/index.ts` is the only public barrel. Keep `*.types.ts` colocated with the
runtime boundary it describes.

## Invariants

- **Negotiation never invents a version.** `initialize` echoes the requested
  version only when `protocolVersions` contains it; everything else falls back
  to `MCP_PROTOCOL_VERSION`. The fallback is the version a client that states
  nothing receives, which is why it stays `2024-11-05`.
- **Do not claim `2026-07-28` compliance.** Discovery is implemented; multi
  round-trip requests, cache hints, and the rest of that revision are not.
  Describe the package as negotiating the handshake versions plus discovery.
- **`server/discover` validates before it answers.** It requires the request
  `_meta`, client capabilities, and a supported version when one is stated.
- **`structuredContent` is an object or absent.** The specification forbids an
  array or scalar root, so a tool that answers one states it in text content.
  `outputSchema` is published only when the tool declares it.
- **Errors are JSON-RPC codes, not AponiaError.** Keep the closed numeric set:
  `-32700`, `-32600`, `-32601`, `-32602`, `-32603`.
- **Capabilities follow the registries.** `resources` and `prompts` appear in
  `initialize` and `server/discover` only when that registry holds an entry;
  `tools` is always advertised. A failed resource read or prompt build answers
  a generic internal error, never the handler's own message.
- Return frozen public descriptors and tool definitions; contracts remain
  immutable.
- Keep the package pure Bun/TypeScript and dependency-free at runtime; do not
  add a transport framework.

## Tests

Bun tests live in `packages/mcp/tests/*.test.ts`, and Vite+ conformance tests in
`packages/mcp/tests-vp/*.conformance.ts`. The Bun lane covers negotiation,
discovery, structured output, and header/meta disagreement; the conformance
lane pins the version constants and the negotiation contract.
