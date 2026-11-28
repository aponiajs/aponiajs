# @aponiajs/platform-h3 — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The H3 binding of an Aponia application. It states only what the runtime owns —
how a native application is created, how each compiled route is registered on
H3's router, how module middleware is mounted, and how a listener is started —
and imports the shared request contract from `@aponiajs/platform-core`.

| Domain         | Owns                                                          |
| -------------- | ------------------------------------------------------------- |
| `application/` | `AponiaFactory`, the managed application type, the middleware |
| `host/`        | `createH3Host` and the request info one H3 context states     |
| `routing/`     | `downloadFile`, the shared disposition header over `Bun.file` |

`src/index.ts` is the only public barrel.

## Invariants

- **Routes are H3's.** Every compiled route registers with `app.on` (or
  `app.all` for `@All()`), so H3's router and middleware precedence decide
  matching; the platform never answers a route it did not mount.
- **Module middleware is H3 middleware.** A module's `configure(consumer)`
  chain mounts once, before the routes, and a short-circuiting middleware
  answers the request itself.
- **Gateways upgrade through crossws.** A gateway mounts as an H3 route built
  with `defineWebSocketHandler`, which a Nitro server upgrades; the Bun
  listener upgrades it through crossws directly. A runtime that loads no
  crossws adapter states no `mountGateway`, and the boot refuses a gateway with
  `UNSUPPORTED_PLATFORM_FEATURE`.
- **No second route table, container, or guard pipeline.** Validation,
  enhancers, lifecycle, version negotiation, and the shared route handler belong
  to `@aponiajs/platform-core`.
- **The managed application is the shared surface.** `AponiaFactory.create`
  returns `platform-core`'s `AponiaHttpApplication`, so the Nest configuration
  methods record their state and `init()` re-runs the boot through this host;
  `getHttpServer()` is the `Bun.serve` object `listen` bound, and is `undefined`
  before `listen`. A delivery adapter keeps its narrower documented surface.
- **No platform depends on another.** This package names only `common` and
  `core`; `scripts/platform-independence.spec.ts` holds it.
- **`fastDispatch` (`O(1)` static dispatch).** By default (`fastDispatch !== false`),
  eligible static routes (no path parameters, middleware, HTTP policies, request
  hooks, versioning, request context, static assets, global pipes, or route
  enhancers beyond zero-argument guards) dispatch through `compileStaticDispatchTable`
  and `Bun.serve({ routes })`, falling back to H3's router for all other requests.
- **`listen` is Bun's server.** The runtime this repository targets is Bun; a
  listener outside it is not emulated.
- **A peer, never a bundled dependency.** An application that never mounts this
  platform does not install H3 through it.

## Tests

`src/**/*.spec.ts` under Bun boot real decorated modules through
`AponiaFactory.create` and read the answers through the native application.
`test/*.conformance.ts` mirrors the public contract and must not call
`listen`: the lane runs on Node, where the Bun listener does not exist.
