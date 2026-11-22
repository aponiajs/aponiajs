# @aponiajs/mcp — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The Model Context Protocol endpoint an Aponia application mounts. The protocol
itself is the official `@modelcontextprotocol/sdk`; this package owns the module
registration, the validated endpoint policy, the request gate, and the lifecycle
of the transports it mounts.

| Domain     | Owns                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `module/`  | `McpModule.register`, the options contract, and the server factory type                        |
| `policy/`  | The configuration guard, the Origin and `authorize` gate, the preflight answer, and the plugin |
| `session/` | The stateful session registry and its `onApplicationShutdown` cleanup                          |

`src/index.ts` is the only public barrel. Keep `*.types.ts` colocated with the
runtime boundary it describes.

## Invariants

- **The SDK is the only protocol implementation.** No JSON-RPC engine, version
  negotiation, discovery, or tool registry lives here. A protocol behavior that
  is missing is the SDK's to add.
- **The factory returns a server factory.** An SDK server connects to exactly
  one transport, so stateless mode builds a server per request and stateful mode
  builds one per session. Never cache a server across requests.
- **Authentication fails closed.** The registration refuses to mount when the
  configuration does not set `allowUnauthenticated: true` and the options carry
  no `authorize`. A `false` answer or a thrown error is a `401`.
- **Origin is checked before authorization.** A request carrying an `Origin`
  the policy does not name is a `403`, and `OPTIONS` is answered without
  reaching the transport.
- **Stateless requests are cleaned up.** The transport and server close when the
  response body ends or the client cancels, including an SSE stream that outlives
  `handleRequest`.
- **Sessions belong to one boot.** `McpSessionRegistry` is a provider, not a
  module-level map, so one application's shutdown cannot close another's
  sessions. `onsessionclosed` deletes, and `onApplicationShutdown` closes every
  transport still held.
- The configuration guard reports every issue with code
  `INVALID_CONFIGURATION_VALUE` and the declaration's name; tests assert the
  code and the issue list, never the message.

## Tests

Bun tests live in `packages/mcp/tests/*.test.ts` and drive the endpoint through
`application.handle` with real `Request` objects. The Vite+ conformance lane
pins the public types in `packages/mcp/tests-vp/*.conformance.ts`.
