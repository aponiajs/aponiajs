# @aponiajs/platform-core — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The runtime-neutral half of an Aponia HTTP platform. It depends on
`@aponiajs/common` and `@aponiajs/core` and on no HTTP runtime: every primitive
here is what `@aponiajs/platform-elysia` and the other platforms run on top of.

| Domain        | Owns                                                              |
| ------------- | ----------------------------------------------------------------- |
| `artifacts/`  | The invoker and module-descriptor artifacts and their selection   |
| `enhancers/`  | The per-request execution context and the compiled guard pipeline |
| `modules/`    | The root module type a platform compiles                          |
| `pipes/`      | Route, application, and parameter pipe resolution and execution   |
| `middleware/` | The middleware consumer contract a module configures              |
| `routing/`    | Route plans, the route-prefix rule, and handler contracts         |

`src/index.ts` is the only public barrel.

## Invariants

- **No HTTP runtime import.** This package may not import `elysia`, `hono`,
  `h3`, `nitro`, or a Bun server API. A platform supplies its own request and
  response objects; this package works with `RouteContext` and the contracts in
  `@aponiajs/common`.
- **One execution context per request.** `StaticRouteExecutionContext` is
  forked per request; a shared mutable instance would let a concurrent request
  replace the context a guard is about to read.
- **A pipe that needs a container never falls back to an empty constructor.**
  `resolveApplicationPipe` propagates `MISSING_PROVIDER`; `resolvePipe` keeps
  its route-level empty-constructor fallback for an enhancer that declares no
  dependencies.
- **Run order is the contract.** Middleware, guards and interceptor before
  halves, the handler, interceptor after halves reversed, filters
  most-specific-first. A platform must not reorder them.
- Everything a public API returns is frozen, as in the rest of the workspace.

## Tests

`tests/*.test.ts` under Bun. The exported primitives are asserted directly: a
container-bound pipe resolves, an unresolvable one fails loudly, a guard list
compiles into the documented order, and the execution context forks without
sharing state.
