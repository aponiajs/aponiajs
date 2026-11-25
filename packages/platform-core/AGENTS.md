# @aponiajs/platform-core — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The runtime-neutral half of an Aponia HTTP platform. It depends on
`@aponiajs/common` and `@aponiajs/core` and on no HTTP runtime: every primitive
here is what `@aponiajs/platform-elysia` and the other platforms run on top of.

| Domain             | Owns                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `application/`     | The shared boot, lifecycle plan, container facade, request pipeline, and boot diagnostics                                                                      |
| `artifacts/`       | The invoker and module-descriptor artifacts and their selection                                                                                                |
| `capabilities/`    | The fixed capability set, the platform's own statement, and the boot refusal a requirement produces                                                            |
| `configuration/`   | The validated configuration provider every module registers                                                                                                    |
| `enhancers/`       | The per-request execution context and the compiled guard pipeline                                                                                              |
| `exceptions/`      | RFC 9457 problem failures and the neutral status-name map                                                                                                      |
| `health/`          | The readiness and liveness probe contract                                                                                                                      |
| `host/`            | `HttpAdapterHost`, the runtime's documented escape hatch                                                                                                       |
| `interfaces/`      | The type-only contracts every platform and policy implements                                                                                                   |
| `kernel/`          | Request decoding, route matching, parameter binding, cookies, request hooks, and response building                                                             |
| `middleware/`      | The middleware consumer and path matching a module configures                                                                                                  |
| `modules/`         | The root module type and the compiler a platform lowers it with                                                                                                |
| `pipes/`           | Route, application, and parameter pipe resolution and execution                                                                                                |
| `platform/`        | The platform adapter host and the plugin registration seams a platform implements internally                                                                   |
| `policy/`          | The response policies every platform applies: CORS, security headers, ETag, compression                                                                        |
| `request-context/` | The per-request async-local context and its registration                                                                                                       |
| `routing/`         | Route plans, the route-prefix rule, handler contracts, version negotiation, the static-asset resolver and response, and the shared content-disposition encoder |
| `websockets/`      | Gateway plans and the shared dispatch primitives                                                                                                               |

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
- **One application surface on every platform.** `AponiaHttpApplication` carries
  the Nest application surface — `useGlobalGuards`, `useGlobalInterceptors`,
  `useGlobalPipes`, `useGlobalFilters`, `enableCors`, `useSecurityHeaders`,
  `setGlobalPrefix`, `enableVersioning`, `enableShutdownHooks`, `useLogger`,
  `flushLogs`, `getHttpServer`, and `init()` — beside `handle`, `tryHandle`,
  `listen`, `getUrl`, `get`, `getHttpAdapter`, and `close`. A configuration
  method records its state in `AponiaApplicationSurfaceConfig`, and `init()`
  re-runs the factory boot once through the same host;
  `mergeApplicationSurfaceOptions` is the one merge, so the Elysia wrapper and
  the shared wrapper cannot drift. `getHttpServer` is the server the host's
  listener bound and is absent before `listen`; a listening host that states no
  server fails it with `UNSUPPORTED_PLATFORM_FEATURE`. A surface method called
  after `init()` is refused with `INVALID_CONFIGURATION`.
- **Gateways speak Nest's surface, not a raw frame.** A handler receives
  `@MessageBody()` and `@ConnectedSocket()`; `client.emit(event, data)` answers
  one client, the `@WebSocketServer()` reference broadcasts, and a handler's
  ordinary result is emitted under the subscribed event. The kernel encodes each
  frame as `{ event, data }` JSON and the host sends it; a failure is an
  `exception` frame with no stack or cause.
- **One capability contract for every platform.** A package contributes neutral
  artifacts — providers, controllers, an `HttpPolicy`, a
  `RequestLifecycleHook` — and states what it needs with
  `requirePlatformCapabilities`. The boot refuses a missing request-path
  capability with `UNSUPPORTED_PLATFORM_FEATURE`, naming the package, the
  capability, and the platform, before anything mounts. `backgroundWork` is a
  deployment note rather than a refusal. A feature package contributes neutral
  artifacts only; no package states a platform allowlist or mounts a native
  feature plugin.
- **Run order is the contract.** Middleware, guards and interceptor before
  halves, the handler, interceptor after halves reversed, filters
  most-specific-first. A platform must not reorder them.
- **Lifecycle order is module distance, not graph position.**
  `collectLifecycleCalls` walks `ModuleGraph.lifecycleModules`: deepest imports
  and global modules first, root last, each module's own declaration order
  preserved. A stopping pass states `reverseModules: true`, which reverses the
  modules and keeps each module's providers in declaration order. Request-scoped
  and transient instances are excluded from every pass.
- **`APP_*` are pseudo-providers.** The four tokens are exempt from the
  duplicate-token rule and every registration runs in declaration order; arrays
  expand where declared. `collectApplicationEnhancerEntries` is the one
  collection every platform uses, and `resolveApplicationEnhancer` resolves a
  class in the module that declared it. There is no fallback that constructs a
  class with no dependencies: a class no module provides raises
  `MISSING_PROVIDER`. Token lookup on an `APP_*` token is refused.
- Everything a public API returns is frozen, as in the rest of the workspace.

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+. The
exported primitives are asserted directly: a container-bound pipe resolves, an
unresolvable one fails loudly, a guard list compiles into the documented order,
and the execution context forks without sharing state.
