# @aponiajs/platform-nitro — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The Nitro entry point over the H3 platform. Nitro serves an H3 application, so
the mount and the request info are H3's; this package states the server handler
a Nitro route exports and names the host for the boot record.

| Domain         | Owns                                              |
| -------------- | ------------------------------------------------- |
| `application/` | `AponiaFactory` and `createAponiaNitroHandler`    |
| `host/`        | `createNitroHost`, the H3 host under Nitro's name |

`src/index.ts` is the only public barrel.

## Invariants

- **Nitro owns the server.** An application started by Nitro never listens;
  `createAponiaNitroHandler` gives Nitro the fetch handler it invokes.
- **Gateways upgrade through crossws.** A gateway mounts as an H3 route built
  with `defineWebSocketHandler`, which Nitro's server upgrades; the Bun
  listener upgrades it through crossws directly. A runtime that loads no
  crossws adapter states no `mountGateway`, and the boot refuses a gateway with
  `UNSUPPORTED_PLATFORM_FEATURE`.
- **The H3 platform is the implementation.** Routing, validation, enhancers, and
  lifecycle are `@aponiajs/platform-core`'s and the mount is
  `@aponiajs/platform-h3`'s; this package adds no second pipeline.
- **A peer, never a bundled dependency.** Nitro and H3 stay peers.

## Tests

`tests/*.test.ts` under Bun boot a real application and drive
`createAponiaNitroHandler` through its `fetch`. `tests-vp/*.conformance.ts`
mirrors the public contract and must not call `listen`.
