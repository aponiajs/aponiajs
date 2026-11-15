# @aponiajs/platform-hono — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The Hono binding of the Aponia kernel. It states only what the runtime owns —
how a native application is created, how the kernel's dispatcher is mounted, how
a request is answered through the native application, and how a listener is
started — and imports the rest from `@aponiajs/platform-core`.

| Domain         | Owns                                                          |
| -------------- | ------------------------------------------------------------- |
| `application/` | `AponiaFactory`, the managed application type, the middleware |
| `host/`        | `createHonoHost` and the request info one Hono context states |

`src/index.ts` is the only public barrel.

## Invariants

- **The dispatch is middleware, not a catch-all.** A request the kernel does not
  answer continues to whatever the application registered next; a catch-all
  route would answer `404` before the application's own routes could.
- **Middleware registered earlier runs earlier.** The host mounts its dispatcher
  when the boot finishes, so `createNative` plus `toHonoPlatformHandler` is the
  shape for an application that already has middleware of its own.
- **Gateways upgrade through Hono's Bun adapter.** A host where that adapter
  does not load states no `mountGateway`, and the boot refuses a graph that
  declares a gateway with `UNSUPPORTED_PLATFORM_FEATURE`.
- **No second route table, container, or guard pipeline.** Routing, validation,
  enhancers, and lifecycle belong to `@aponiajs/platform-core`.
- **`listen` is Bun's server.** The runtime this repository targets is Bun; a
  listener outside it is not emulated.
- **A peer, never a bundled dependency.** An application that never mounts this
  platform does not install Hono through it.

## Tests

`tests/*.test.ts` under Bun boot real decorated modules through
`AponiaFactory.create` and read the answers through the native application.
`tests-vp/*.conformance.ts` mirrors the public contract and must not call
`listen`: the lane runs on Node, where the Bun listener does not exist.
