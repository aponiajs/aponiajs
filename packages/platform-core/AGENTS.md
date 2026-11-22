# @aponiajs/platform-core — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The runtime-neutral half of an Aponia HTTP platform. It depends on
`@aponiajs/common` and `@aponiajs/core` and on no HTTP runtime: every primitive
here is what `@aponiajs/platform-elysia` and the other platforms run on top of.

| Domain             | Owns                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `artifacts/`       | The invoker and module-descriptor artifacts and their selection                                                                                                |
| `configuration/`   | The validated configuration provider every module registers                                                                                                    |
| `enhancers/`       | The per-request execution context and the compiled guard pipeline                                                                                              |
| `errors/`          | RFC 9457 problem failures and the neutral status-name map                                                                                                      |
| `modules/`         | The root module type and the compiler a platform lowers it with                                                                                                |
| `pipes/`           | Route, application, and parameter pipe resolution and execution                                                                                                |
| `policy/`          | The response policies every platform applies: CORS, security headers, ETag, compression                                                                        |
| `middleware/`      | The middleware consumer and path matching a module configures                                                                                                  |
| `plugins/`         | The platform declaration, the neutral plugin builders, and the adapter host                                                                                    |
| `request-context/` | The per-request async-local context and its registration                                                                                                       |
| `routing/`         | Route plans, the route-prefix rule, handler contracts, version negotiation, the static-asset resolver and response, and the shared content-disposition encoder |

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
- **Response policies run at the request boundary.** `cors` answers a preflight
  before routing; the security headers, the entity tag, and compression transform
  the final response. The boot compiles them into one `RequestPipeline` that
  both `handle` and `listen` run, so a host that serves through its native fetch
  cannot answer unpolicied requests.
- **Static assets are one rule and one response shape.** `resolveStaticAssetPath`
  owns the path rule (prefix, index, traversal refusal) and `answerStaticAsset`
  owns the headers; a host supplies only the file opener. Static files answer
  before middleware and routes and carry no enhancer.
- **Version negotiation is shared.** `createVersionNegotiator` compiles one table
  from the booted routes; every platform applies it before its router sees the
  request. A platform must not reimplement the table or the rewrite.
- **One factory, many native platforms.** `AponiaFactory.create(root, { adapter })`
  accepts a host (`honoAdapter()`, `h3Adapter()`) or an
  application adapter (`elysiaAdapter()`), and returns the same application
  surface either way. A host registers each compiled route on its own router and
  calls the shared route handler; `listen` resolves with the application,
  `getUrl` states the bound address, and `getHttpAdapter` is the runtime's own
  object.
- **Gateways speak Nest's surface, not a raw frame.** A handler receives
  `@MessageBody()` and `@ConnectedSocket()`; `client.emit(event, data)` answers
  one client, the `@WebSocketServer()` reference broadcasts, and a handler's
  ordinary result is emitted under the subscribed event. The kernel encodes each
  frame as `{ event, data }` JSON and the host sends it; a failure is an
  `exception` frame with no stack or cause.
- **One plugin standard for every platform.** A package declares its platforms
  with `providePlatformModule` and states a native mount per platform in
  `adapters`. The boot refuses an undeclared platform with
  `UNSUPPORTED_PLATFORM_FEATURE` before anything mounts, then runs
  `adapters[platform]`. `PluginModule`, `createServicePlugin`, and
  `createEnhancerPlugin` all emit that declaration, so a package that uses the
  standard shape states its support without writing it twice.
- **Run order is the contract.** Middleware, guards and interceptor before
  halves, the handler, interceptor after halves reversed, filters
  most-specific-first. A platform must not reorder them.
- Everything a public API returns is frozen, as in the rest of the workspace.

## Tests

`tests/*.test.ts` under Bun. The exported primitives are asserted directly: a
container-bound pipe resolves, an unresolvable one fails loudly, a guard list
compiles into the documented order, and the execution context forks without
sharing state.
