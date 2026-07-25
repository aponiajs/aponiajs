# Aponia NPM Package Architecture Roadmap

Status: Draft for implementation  
Scope: Define independently publishable Aponia packages by mapping proven NestJS
capabilities onto a Bun-first, Elysia-native architecture.

## 1. Objective

The framework should be distributed as small NPM packages under the
`@aponiajs` scope. Applications install only the capabilities they use.

The package architecture must:

- Keep dependency injection and application lifecycle independent from Elysia.
- Keep HTTP and Elysia-specific behavior outside the core container.
- Preserve Elysia route, schema, plugin, and context type inference.
- Consume existing Elysia libraries and plugins without reimplementation.
- Compile Aponia modules into ordinary Elysia plugins that existing Elysia
  applications can consume.
- Preserve Nest-inspired module, service, and controller organization without
  replacing Elysia's route and plugin APIs.
- Use Bun for runtime execution, package management, workspace orchestration,
  and the primary test suite.
- Retain Vite+ for package builds, formatting, linting, type checking, and the
  conformance test lane.
- Avoid mandatory decorators, reflection metadata, RxJS, or Node-only APIs.
- Support independent feature packages without creating duplicate framework instances.

## 2. NestJS reference model

NestJS separates its foundation into `common`, `core`, platform adapters,
`testing`, `websockets`, and `microservices`. Its documentation adds controllers,
providers, modules, middleware, guards, pipes, interceptors, exception filters,
custom providers, scopes, discovery, lifecycle events, configuration, caching,
serialization, versioning, scheduling, queues, logging, health checks, OpenAPI,
GraphQL, WebSockets, and multiple microservice transports.

Aponia should reuse the responsibility boundaries, not the implementation:

| NestJS concept or package                         | Aponia destination                                                    | Adaptation rule                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `@nestjs/common`                                  | `@aponiajs/common`, `@aponiajs/http`, optional `@aponiajs/decorators` | Split stable contracts from HTTP descriptors and syntax sugar       |
| `@nestjs/core`                                    | `@aponiajs/core`                                                      | Explicit descriptors instead of reflection scans                    |
| Abstract HTTP adapter                             | `@aponiajs/platform`                                                  | Transport capability contracts only                                 |
| `@nestjs/platform-express` and `platform-fastify` | `@aponiajs/platform-elysia`                                           | Compile directly to native Elysia plugins and phases                |
| `@nestjs/testing`                                 | `@aponiajs/testing`                                                   | Bun test, in-memory request handling, typed overrides               |
| `@nestjs/websockets` and WebSocket platforms      | `@aponiajs/websockets`, `@aponiajs/platform-elysia-ws`                | Use Elysia and Bun WebSocket primitives                             |
| `@nestjs/microservices`                           | `@aponiajs/microservices` plus transport packages                     | Separate message contracts from broker drivers                      |
| `@nestjs/config`                                  | `@aponiajs/config`                                                    | Bun environment loading with typed validation and secret references |
| `@nestjs/swagger`                                 | `@aponiajs/openapi`                                                   | Aggregate native Elysia schemas without rescanning handlers         |
| `@nestjs/terminus`                                | `@aponiajs/health`                                                    | Liveness, readiness, startup, and drain-aware indicators            |
| `@nestjs/event-emitter`                           | `@aponiajs/events`                                                    | Typed local event bus                                               |
| `@nestjs/schedule`                                | `@aponiajs/schedule`                                                  | Bun-compatible scheduler with lifecycle ownership                   |
| `@nestjs/cache-manager`                           | `@aponiajs/cache`                                                     | Cache contracts plus separate store adapters                        |
| `@nestjs/throttler`                               | `@aponiajs/rate-limit`                                                | Trusted-identity-aware limiter contracts and stores                 |
| `@nestjs/passport` and JWT integrations           | `@aponiajs/auth`                                                      | Framework-native principal and policy contracts                     |
| `@nestjs/graphql`                                 | `@aponiajs/graphql`                                                   | Optional GraphQL integration after HTTP stability                   |
| `@nestjs/cqrs`                                    | `@aponiajs/cqrs`                                                      | Deferred until core and event contracts are stable                  |
| Nest CLI and schematics                           | `@aponiajs/cli`, `@aponiajs/schematics`, `create-aponia`              | AST-safe generation and Bun workspace support                       |

## 3. Package design rules

### 3.0 Native Elysia compatibility invariant

Aponia is an architecture layer around Elysia, not an alternate Elysia API.

The integration must be bidirectional:

```text
Existing Elysia application
  .use(compiledAponiaModule)

Aponia application or module
  .use(existingElysiaPlugin)
```

Required behavior:

- Every plugin form accepted by the selected Elysia version's public `.use()`
  input type can pass through unchanged: Elysia instances, functional plugins,
  async or deferred functional plugins, lazy-import module promises, and plugin
  arrays or tuples when Elysia supports them.
- Aponia derives its accepted native-plugin type from Elysia's exact public
  `.use()` input contract instead of maintaining a narrower parallel union.
- Native values pass through without copying their routes, hooks, state,
  decorators, models, macros, schemas, or metadata.
- Existing Elysia ecosystem packages keep their documented configuration and API.
- Plugin registration order remains visible and follows Elysia semantics.
- Plugin local, scoped, and global behavior is not silently rewritten.
- Plugin generic state is carried through the Aponia builder type.
- An Aponia module compiles to an Elysia plugin with a stable name and explicit
  instance identity.
- Raw Elysia applications can use compiled Aponia modules through `.use()`.
- Aponia services may be exposed to Elysia handlers only through an explicit,
  typed context bridge.
- Native plugin handlers do not receive hidden Aponia DI access.
- Unsupported plugin behavior fails with a compile-time error when possible and
  a bootstrap diagnostic otherwise.
- Deferred and lazy plugins retain Elysia's native module-readiness behavior,
  including the host application's `modules` barrier.

Compatibility modes:

| Mode                     | Use case                                                                             | Guarantees                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Native plugin dependency | Any supported `.use()` input adds context or behavior consumed by Aponia controllers | Exact supported-input inference; plugin registers before controllers                                     |
| Native route plugin      | Plugin owns its routes and handlers                                                  | Routes and hooks remain unchanged; Aponia owns outer application lifecycle                               |
| Isolated mount           | Complete Elysia application mounted under a prefix                                   | Native behavior retained; Aponia DI and global policies do not enter the mount unless explicitly bridged |
| Aponia-as-Elysia plugin  | Existing Elysia application consumes an Aponia module                                | Compiled routes, lifecycle, and DI remain managed by Aponia                                              |

No compatibility layer may convert a plugin to `Elysia<any>` or flatten its
context to `Record<string, unknown>`.

Registration and ownership rules:

- A module owns one ordered `const` tuple of native plugin registrations.
- Controllers are created inside a typed module builder that receives the
  accumulated context from all preceding native registrations.
- A controller references the accumulated context but does not register those
  plugins again.
- Each user-declared registration is forwarded to Elysia exactly once and in
  source order.
- Aponia does not deduplicate plugins by identity or invent alternate checksum
  behavior. Elysia name and seed semantics remain authoritative.
- Repeating a plugin in the module tuple is an explicit user registration and
  retains native Elysia behavior.
- Isolated mounts remain a separate descriptor because `.mount()` and `.use()`
  do not have identical lifecycle or inference semantics.

### 3.0.1 Nest-inspired structure with Elysia-native handlers

Modules own dependency and visibility boundaries. Services contain business
logic. Controllers organize Elysia-native route builders.

```ts
class UsersService {
  listFor(token: string) {
    return [{ id: "1", token }];
  }
}

const UsersModule = defineElysiaModule({
  nativePlugins: [bearer()] as const,
  providers: [provideClass(UsersService)],
  controllers: ({ controller }) => [
    controller({
      prefix: "/users",
      inject: [UsersService],
      routes: ({ route, services: [users] }) =>
        route.get("/", ({ bearer }) => users.listFor(bearer), {
          response: t.Array(
            t.Object({
              id: t.String(),
              token: t.String(),
            }),
          ),
        }),
    }),
  ],
});

const plugin = compileAponiaModule(UsersModule);

new Elysia().use(plugin).listen(3000);
```

The exact helper names are provisional, but the following contract is not:

- The native plugin value is registered once and passed through unchanged.
- The controller route callback sees the plugin-provided `bearer` type.
- The service is resolved through Aponia DI.
- The compiled module remains a native Elysia plugin.
- No route or plugin must be rewritten into an Aponia-only equivalent.

### 3.0.2 Raw-host readiness and failure contract

Compiling an Aponia module has two phases:

1. Synchronous descriptor and route construction preserves the exact Elysia
   plugin type returned to `.use()`.
2. An Elysia-native deferred readiness phase initializes async Aponia providers
   and composes with native deferred or lazy plugin readiness.

Required semantics:

- An unchanged raw host may call `new Elysia().use(compiledModule)`; it does not
  need an Aponia application wrapper.
- The compiled plugin participates in Elysia's public module-readiness
  mechanism, and its explicit `ready` handle is also available to tests and
  non-listening hosts.
- `listen()` cannot accept traffic until native plugin modules and Aponia async
  providers are ready.
- Immediate `app.handle()` either awaits the composed readiness barrier or
  rejects with a stable not-ready diagnostic; the selected behavior must be
  proven against the pinned Elysia version and documented before release.
- Initialization failure rejects deterministically, prevents traffic, and
  disposes all partially created Aponia resources in reverse order.
- Native deferred readiness and Aponia provider readiness form one acyclic
  barrier with a timeout and cancellation path.
- Host shutdown disposes Aponia resources exactly once, then completes native
  host shutdown in a documented order. Repeated stop or disposal is idempotent.
- Raw-host conformance covers async success, failure, timeout, cancellation,
  immediate `handle()`, `listen()`, deferred native plugins, and shutdown.

### 3.1 Dependency direction

- Foundation packages never import platform implementations.
- `common` imports no other Aponia package.
- `core` imports only `common`, including the minimal `PlatformAdapter` SPI.
- `platform` imports only `common` and provides optional adapter base classes,
  capability utilities, and contract tests. It never imports `core`.
- `http` imports `common` and platform-neutral contracts.
- `platform-elysia` composes `common`, `core`, `http`, and `platform`, and has
  `elysia` and foundation packages as peer dependencies.
- Feature packages depend on public contracts, never private source paths.
- Integration packages use peer dependencies for optional third-party systems.
- Circular package dependencies fail CI.

### 3.2 Public API discipline

- Every package has an explicit `exports` map.
- Cross-package imports use package exports, never `../../other-package/src`.
- Internal symbols live under unexported `internal/` modules.
- Exported APIs do not contain `any`.
- Public types have positive and negative compile tests.
- Decorators emit immutable descriptors and do not add unique runtime behavior.
- Platform-specific request or response objects cannot leak into `core`.

### 3.3 Versioning

- Foundation packages use synchronized versions:
  `common`, `core`, `http`, `platform`, `platform-elysia`, and `testing`.
- Optional integrations may use independent versions after version 1.
- Identity-bearing foundation packages are required peer dependencies plus
  workspace development dependencies. They are not nested regular dependencies.
- During workspace development, internal dependencies use `workspace:*`.
- Peer ranges use the same major version and a documented minimum minor.
- Built-in global tokens use a versioned `Symbol.for("@aponiajs/<token>/v1")`
  namespace. User-created typed tokens retain object identity.
- Application bootstrap rejects incompatible or duplicate foundation runtime identities.
- Every breaking public type change requires a major release.

### 3.4 Runtime and packaging

- Packages are ESM-first.
- Published output includes `dist/*.mjs` and `dist/*.d.mts`.
- Bun-targeted packages may add a `"bun"` export condition for source or optimized output.
- `sideEffects` is `false` unless a package explicitly registers global behavior.
- `files` contains only publishable output, README, LICENSE, and package metadata.
- `engines.bun` declares the supported Bun range.
- Each package is validated with `bun pm pack --dry-run`.

### 3.5 Foundation manifest policy

| Package           | Runtime dependencies | Required peer dependencies                     | Development dependencies   |
| ----------------- | -------------------- | ---------------------------------------------- | -------------------------- |
| `common`          | None                 | None                                           | Toolchain only             |
| `core`            | None                 | `common`                                       | Workspace `common`         |
| `platform`        | None                 | `common`                                       | Workspace `common`         |
| `http`            | None                 | `common`, `platform`                           | Workspace peers            |
| `platform-elysia` | None                 | `common`, `core`, `platform`, `http`, `elysia` | Workspace peers and Elysia |
| `testing`         | None                 | `common`, `core`, `platform`                   | Workspace peers            |
| `testing-elysia`  | None                 | `testing`, foundation packages, `elysia`       | Workspace peers and Elysia |
| `decorators`      | None                 | `common`; `http` only for HTTP decorators      | Workspace peers            |

Pure type-only imports use `import type`. Runtime identity-bearing foundation
packages remain peers to prevent nested copies. Consumer fixtures must test:

- Matching versions.
- Unsupported major versions.
- A lower unsupported minor version.
- Deliberately duplicated physical copies.
- A plugin compiled with one foundation version and consumed by another.

Bootstrap performs a foundation runtime handshake and reports every loaded
package version when it detects an incompatible identity.

## 4. Foundation package catalog

### 4.1 `@aponiajs/common`

Purpose: Stable, platform-independent contracts and utility types.

Required components:

- Typed token creation and token identity.
- Module, provider, endpoint-neutral, and lifecycle descriptor types.
- Provider definitions for value, factory, class, alias, optional, and multi-provider cases.
- Provider scope and module visibility enums.
- Framework error base classes and diagnostic codes.
- Lifecycle interfaces for initialization, bootstrap, drain, and disposal.
- Execution context contracts without Elysia imports.
- Minimal `PlatformAdapter` SPI required by `ApplicationContext`: initialize,
  listen, handle, drain, close, address, native instance, capabilities, and
  error translation.
- Logger, clock, cancellation, and secret-reference interfaces.
- Shared utility types and status-neutral result types.
- Public constants that are safe across package versions.

Must not contain:

- A DI container.
- Elysia, routing, server startup, or request parsing.
- Reflection metadata scanning.
- Feature implementations.

### 4.2 `@aponiajs/core`

Purpose: Compile and execute the application graph.

Required components:

- `ApplicationFactory` and platform-neutral `ApplicationContext`.
- Module compiler and immutable module instance identity.
- Import, export, visibility, and global-module graph.
- Dependency container and typed injector.
- Singleton, request, and transient scopes.
- Async provider resolution, timeout, cancellation, and failure cleanup.
- Reverse-topological disposal.
- Circular, missing, duplicate, and scope-leak diagnostics.
- Lifecycle coordinator.
- Discovery registry and graph inspector.
- Runtime context IDs and request-scope ownership.
- Shutdown and drain coordinator without installing global signal handlers.
- Compile-time and runtime instrumentation hooks.

Internal subsystems:

```text
core/
|-- application/
|-- container/
|-- discovery/
|-- graph/
|-- injector/
|-- inspector/
|-- lifecycle/
|-- scopes/
|-- shutdown/
`-- diagnostics/
```

Must not contain:

- Elysia imports.
- HTTP routing or status codes.
- Authentication, databases, queues, or broker clients.
- Hidden service locator access for application code.

### 4.3 `@aponiajs/platform`

Purpose: Provide reusable utilities around the minimal adapter SPI in `common`.

Required components:

- Abstract adapter base classes.
- Transport capability negotiation and assertions.
- Native instance and native context helper types.
- Route and message compiler utility contracts.
- Request, response, connection, and cancellation helpers.
- Adapter contract test kit.
- Platform health and address utilities.
- Managed, isolated, and unsafe extension classifications.

Must not contain:

- A router implementation.
- Elysia or Bun server implementation details.
- DI ownership or imports from `core`.

### 4.4 `@aponiajs/http`

Purpose: Platform-neutral HTTP authoring contracts.

Required components:

- Typed controller and route descriptors.
- Route method, path, prefix, version, host, and operation metadata.
- Request schema slots for params, query, headers, cookies, and body.
- Status-specific response schemas.
- Request hook, transform, authentication, authorization, response mapper, and
  cleanup contracts aligned to real transport phases.
- Problem Details and HTTP exception contracts.
- Serialization and response-header contracts.
- Middleware compatibility boundary for raw request concerns.
- Upload, streaming, SSE, and cancellation interfaces.

Design constraint:

Nest-style guards, pipes, interceptors, and filters may be exposed as familiar
aliases, but the canonical API must remain phase-specific so it can map
correctly to Elysia.

### 4.5 `@aponiajs/platform-elysia`

Purpose: Implement the Aponia HTTP platform using Elysia.

Required components:

- `ElysiaAdapter` and `ElysiaApplication`.
- `defineElysiaModule` with an ordered native-plugin tuple and a typed controller
  builder that receives the accumulated context.
- `defineElysiaController` with tuple-preserving route descriptors.
- `useElysiaPlugin` that retains the exact Elysia `.use()` input and output
  types for instances, functions, deferred plugins, lazy imports, and supported
  arrays or tuples.
- `compileAponiaModule` that returns a native Elysia plugin type.
- A composed native/Aponia readiness barrier and explicit testable `ready`
  handle.
- Controller and route descriptor compiler.
- Elysia plugin tree compiler.
- Local, scoped, and global lifecycle mapper.
- `request`, `parse`, `transform`, validation, `resolve`, `beforeHandle`,
  handler, `afterHandle`, `mapResponse`, `afterResponse`, and `onError` mapping.
- Native Elysia plugin composition.
- Elysia context type widening and propagation.
- Request-scope context creation and disposal.
- Error and Problem Details mapping.
- `app.handle(Request)` integration.
- Bun listen, stop, drain, address, and abort behavior.
- Streaming, file, SSE, and WebSocket capability declaration.
- Conformance tests for short circuits, errors, native responses, streams,
  aborts, and plugin scope.

Type contract:

```ts
type NativeElysiaPluginInput = Parameters<Elysia["use"]>[0];

declare function useElysiaPlugin<const TPlugin extends NativeElysiaPluginInput>(
  plugin: TPlugin,
): ElysiaPluginDependency<TPlugin>;

declare function defineElysiaModule<
  const TPlugins extends readonly NativeElysiaPluginInput[],
  const TProviders extends readonly ProviderDescriptor[],
  const TControllers extends readonly ElysiaControllerDescriptor[],
>(
  descriptor: ElysiaModuleDescriptor<TPlugins, TProviders, TControllers>,
): TypedElysiaModule<TPlugins, TProviders, TControllers>;

declare function compileAponiaModule<const TModule extends TypedElysiaModule>(
  module: TModule,
): CompiledElysiaModule<TModule> & {
  readonly ready: Promise<void>;
};
```

The signatures are illustrative. The implementation must derive the accepted
input and accumulated output from the pinned Elysia version's exact public
generics, including overloaded or conditional behavior that a simple
`Parameters` expression may not preserve. It must not export an `any`
specialization.

Inference boundary:

- Statically declared `const` plugin, module, controller, and route tuples
  preserve full inference.
- Dynamic runtime module discovery returns a documented widened type and cannot
  promise Eden Treaty inference for undiscovered routes.
- Dynamic modules that require end-to-end types must expose a statically typed
  factory return value.
- Plugin dependencies register before every controller that consumes their context.
- Functional, deferred, lazy-import, and supported tuple plugin forms retain
  their native inferred result.
- Deferred fixtures verify Elysia's `app.modules` readiness behavior.
- One canonical module registration feeds controller context types without a
  second `.use()` call.

Lifecycle mapping:

| Elysia phase                 | Aponia responsibility                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| `request`                    | Request identity, trace extraction, and early admission metadata |
| `parse`                      | Native or plugin parser selection and bounded body handling      |
| `transform` and `derive`     | Pre-validation coercion and typed derived context                |
| Validation                   | Native Elysia request and response schemas                       |
| `resolve` and `beforeHandle` | Validated identity, authorization, and request-scope services    |
| Handler                      | Elysia-native controller callback                                |
| `afterHandle`                | Typed result transformation                                      |
| `mapResponse`                | Final response, headers, status, and serialization               |
| `onError`                    | Problem Details and native error translation                     |
| `afterResponse`              | Cleanup, metrics, request-scope disposal, and audit              |
| Trace                        | Phase timing and OpenTelemetry correlation                       |

The contract suite covers registration order, short circuits, thrown errors,
native responses, success, failure, client abort, streaming cleanup, local,
scoped, global, parent, and descendant propagation.

Required native plugin fixtures:

- Official bearer, CORS, JWT, OpenAPI, and OpenTelemetry plugins.
- A plugin that adds state and decorators.
- A plugin that registers models and macros.
- A plugin that owns routes.
- A configured plugin used twice with different instance identities.
- Eden Treaty inference over mixed native and Aponia routes.
- Negative compile tests for missing registration order, unavailable derived
  context, invalid macro use, and status-specific response mismatch.

Peer dependencies:

- `elysia`
- Matching major versions of Aponia foundation packages.

Must not:

- Reimplement Elysia routing.
- Convert all native context types to generic records.
- Change Elysia hook order.

### 4.6 `@aponiajs/testing`

Purpose: Test modules and applications with Bun test.

Required components:

- `TestModuleBuilder`.
- Provider, module, platform, policy, and lifecycle override APIs.
- Typed mock and fake provider helpers.
- In-memory platform adapter for core-only tests.
- Fake clock and deterministic cancellation.
- Bootstrap failure and shutdown assertion helpers.
- Open handle and provider leak detection.
- Compile-test helpers for public type contracts.

The root export is core and platform neutral. It must not expose Elysia types.

### 4.7 `@aponiajs/testing-elysia`

Purpose: Elysia-specific testing helpers without forcing Elysia on core-only consumers.

Required components:

- Elysia test application builder.
- Typed `app.handle(Request)` test client.
- Native plugin and context fixtures.
- Overrides for policies, transforms, response mappers, errors, and global enhancers.
- Controlled request context IDs and request-scoped resolution.
- Compile, initialize, close, and auto-mocking integration.

Peer dependencies:

- `elysia`
- `@aponiajs/testing`
- Matching Aponia foundation packages.

### 4.8 `@aponiajs/decorators`

Purpose: Optional Nest-inspired syntax sugar.

Required components:

- Module, controller, route, injectable, inject, optional, and lifecycle decorators.
- Descriptor emission compatible with the functional API.
- No request-path reflection scan.
- Functional-versus-decorator parity tests.

This package is optional and must never be a dependency of `core`.

## 5. First-party capability packages

### Release wave A: Production HTTP essentials

| Package                        | Primary responsibility                     | Core components                                                                                                              |
| ------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `@aponiajs/config`             | Typed configuration                        | Environment loading, schema validation, namespaces, async sources, secret references, configuration snapshots without values |
| `@aponiajs/validation`         | Validation adapters                        | Native Elysia schema integration, transformation policy, unknown-field policy, reusable validation contracts                 |
| `@aponiajs/serialization`      | Output mapping                             | Response projection, field exclusion, redaction, date and binary policies                                                    |
| `@aponiajs/security`           | Secure HTTP defaults                       | Trusted proxies, host validation, CORS, headers, cookies, size limits, raw-body policy, compression policy, TLS assumptions  |
| `@aponiajs/auth`               | Authentication and authorization contracts | Principal, credentials, policy evaluator, default-deny authorization                                                         |
| `@aponiajs/auth-jwt`           | JWT implementation                         | Algorithm allowlist, claims, JWKS, rotation, timeout, and cache policy                                                       |
| `@aponiajs/auth-session`       | Session implementation                     | Secure cookies, signing, CSRF, renewal, fixation prevention, and revocation                                                  |
| `@aponiajs/rate-limit`         | Request throttling contracts               | Key derivation, policies, in-memory store, distributed store contract, outage semantics                                      |
| `@aponiajs/rate-limit-redis`   | Distributed limiter adapter                | Atomic Redis operations and outage behavior                                                                                  |
| `@aponiajs/observability`      | Observability contracts                    | Structured logger, request IDs, redaction, trace, and metric interfaces                                                      |
| `@aponiajs/observability-otel` | OpenTelemetry implementation               | Official Elysia OpenTelemetry bridge and exporters                                                                           |
| `@aponiajs/health`             | Operational health                         | Liveness, readiness, startup, dependency indicators, drain-aware readiness                                                   |
| `@aponiajs/openapi`            | API description                            | Operation metadata, Elysia OpenAPI aggregation, schema snapshots, security schemes, versioned documents                      |

### Release wave B: Common application infrastructure

| Package                 | Primary responsibility | Adapter strategy                                                            |
| ----------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `@aponiajs/cache`       | Cache contracts        | Cache policy, key, TTL, invalidation, and store contracts                   |
| `@aponiajs/cache-redis` | Redis cache adapter    | Redis store, connection lifecycle, and outage behavior                      |
| `@aponiajs/events`      | In-process events      | Typed event map, async listeners, error policy, lifecycle cleanup           |
| `@aponiajs/schedule`    | Scheduled work         | Cron and interval definitions, overlap policy, graceful stop                |
| `@aponiajs/queues`      | Background jobs        | Queue contracts plus separate BullMQ or broker adapters                     |
| `@aponiajs/files`       | Upload and storage     | Upload policy, stream ownership, local and object-store adapters            |
| `@aponiajs/http-client` | Outbound HTTP          | Typed client boundary, timeout, retry, cancellation, SSRF policy, telemetry |
| `@aponiajs/database`    | Persistence lifecycle  | Connection and transaction context contracts; ORM adapters remain separate  |

### Release wave C: Additional transports and architecture patterns

| Package                               | Primary responsibility                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `@aponiajs/websockets`                | Gateway, message descriptor, connection context, adapter SPI, policies, errors, and lifecycle    |
| `@aponiajs/platform-elysia/websocket` | Elysia and Bun WebSocket implementation as a subpath unless heavy peers require a package        |
| `@aponiajs/microservices`             | Message patterns, request-response, events, serializers, retry, context, and transport contracts |
| `@aponiajs/transport-tcp`             | TCP message transport                                                                            |
| `@aponiajs/transport-mqtt`            | MQTT message transport                                                                           |
| `@aponiajs/transport-redis`           | Redis message transport                                                                          |
| `@aponiajs/transport-nats`            | NATS message transport                                                                           |
| `@aponiajs/transport-kafka`           | Kafka message transport                                                                          |
| `@aponiajs/transport-rabbitmq`        | RabbitMQ message transport                                                                       |
| `@aponiajs/transport-grpc`            | gRPC message transport                                                                           |
| `@aponiajs/graphql`                   | GraphQL schema, resolver, context, subscriptions, and federation integration                     |
| `@aponiajs/cqrs`                      | Commands, queries, events, buses, sagas, and handlers                                            |

WebSocket contract requirements:

- Adapter SPI for connect, disconnect, bind message handlers, send, broadcast,
  close, and drain.
- Handshake authentication, origin validation, and connection limits.
- Per-message schemas, policies, transforms, and error mapping.
- Acknowledgement and response contracts.
- Frame and message size limits, heartbeat, close codes, and idle timeout.
- Slow-consumer backpressure and bounded outbound queues.
- Request-scope ownership for connections and messages.

Microservice contract requirements:

- Client and server roles.
- Request-response and event messaging.
- Correlation IDs, deadlines, cancellation, and typed transport contexts.
- Promise and `AsyncIterable` streaming instead of mandatory RxJS semantics.
- Serializer and deserializer boundaries.
- Reconnect, exponential backoff, and bounded retry.
- Delivery, ordering, concurrency, acknowledgement, and dead-letter policies.
- Idempotency hooks and poison-message handling.
- Custom transporter SPI.
- Hybrid application configuration with explicit inheritance.
- Transport-specific capability declarations so unsupported semantics fail early.

### Developer tooling packages

| Package                | Primary responsibility                                                             |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `@aponiajs/cli`        | `new`, `build`, `start`, `doctor`, `graph`, and migration commands                 |
| `@aponiajs/schematics` | AST-safe module, controller, provider, and capability generators                   |
| `create-aponia`        | Minimal project bootstrap package                                                  |
| `@aponiajs/devtools`   | Module graph, route graph, provider graph, diagnostics, and performance inspection |

## 6. Dependency graph

```text
@aponiajs/common
  |
  +-- @aponiajs/core
  |
  +-- @aponiajs/platform
  |
  +-- @aponiajs/http
        |
        +-- @aponiajs/platform-elysia

@aponiajs/testing
  +-- common
  +-- core
  `-- platform

@aponiajs/testing-elysia
  +-- testing
  +-- foundation peers
  `-- elysia peer

Production feature packages
  +-- common
  +-- core as peer when module integration is required
  +-- http or platform contracts when transport-aware
  `-- platform-elysia only when implementation is Elysia-specific
```

Forbidden edges:

- `common -> core`
- `core -> platform-elysia`
- `core -> http`
- `platform -> platform-elysia`
- `core -> feature package`
- `feature package A -> feature package B` unless a public integration contract
  is explicitly approved.

Complete edge policy:

| Consumer                 | Provider                                         | Edge type                                              |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------ |
| `core`                   | `common`                                         | Required peer plus workspace development dependency    |
| `platform`               | `common`                                         | Required peer plus workspace development dependency    |
| `http`                   | `common`, `platform`                             | Required peers plus workspace development dependencies |
| `platform-elysia`        | Foundation packages, `elysia`                    | Required peers plus workspace development dependencies |
| `testing`                | `common`, `core`, `platform`                     | Required peers plus workspace development dependencies |
| `testing-elysia`         | `testing`, foundation packages, `elysia`         | Required peers plus workspace development dependencies |
| Feature contract package | `common`; `core` only when it registers a module | Required peers                                         |
| Third-party adapter      | Its contract package and client library          | Required peers                                         |

The repository stores the edge policy in a machine-readable file and CI
generates the diagram from it. Documentation cannot be the only enforcement.

## 7. Standard package contract

Every publishable package uses this baseline:

```json
{
  "name": "@aponiajs/example",
  "version": "0.0.0",
  "type": "module",
  "sideEffects": false,
  "files": ["dist", "README.md", "LICENSE"],
  "exports": {
    ".": {
      "types": "./dist/index.d.mts",
      "import": "./dist/index.mjs"
    },
    "./package.json": "./package.json"
  },
  "engines": {
    "bun": ">=1.3.14"
  },
  "publishConfig": {
    "access": "public",
    "provenance": true
  }
}
```

Additional requirements:

- Add explicit subpath exports only when they are intentionally public.
- Use peer dependencies for Elysia and optional infrastructure clients.
- Validate packed files, ESM imports, type declarations, and tree shaking.
- Each library exposes `bun run build`; the package script may delegate to
  internal packaging tooling.
- Each package `vite.config.ts` defines its entry, ESM output, declarations,
  clean output, externals, and sourcemaps.
- Publish SBOM and verified provenance artifacts.
- Include README sections for installation, compatibility, lifecycle ownership,
  security behavior, and migration.

Per-package release verification:

```bash
bun --cwd packages/<name> run build
bun --cwd packages/<name> pm pack --dry-run
bun --cwd packages/<name> pm pack --destination <temporary-directory>
bun --cwd packages/<name> publish --dry-run
```

The real tarball is installed into a clean external Bun fixture. The fixture
tests imports, declarations, every export condition, startup, peer warnings,
and the absence of unresolved `workspace:` or `catalog:` protocols.

Provenance policy:

- Use NPM trusted publishing through a public GitHub-hosted workflow.
- Grant only `contents: read` and `id-token: write`.
- Set `NPM_CONFIG_PROVENANCE=true` for the selected publishing client.
- Verify the registry provenance attestation before promoting a release.
- Do not claim provenance support based only on `publishConfig.provenance`.
- If Bun publish cannot complete the trusted-publisher flow at release time,
  use the supported NPM publication client for the publish step and retain Bun
  for install, test, build, pack, and artifact verification.

## 8. Repository layout

```text
packages/
|-- common/
|-- core/
|-- platform/
|-- http/
|-- platform-elysia/
|-- testing/
|-- testing-elysia/
|-- decorators/
|-- config/
|-- validation/
|-- serialization/
|-- security/
|-- auth/
|-- auth-jwt/
|-- auth-session/
|-- rate-limit/
|-- observability/
|-- health/
`-- openapi/

apps/
|-- examples-basic/
|-- examples-auth/
|-- examples-openapi/
`-- benchmarks/
```

Every package contains:

```text
package-name/
|-- src/
|   `-- index.ts
|-- tests/
|-- tests-vp/
|-- package.json
|-- tsconfig.json
|-- vite.config.ts
`-- README.md
```

## 9. NestJS capability disposition

Every documented NestJS capability receives an explicit disposition:

| Capability                                | Disposition                        | Aponia owner or rationale                                            |
| ----------------------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| Modules, providers, controllers           | Version 1                          | `common`, `core`, `http`, `platform-elysia`                          |
| Custom and async providers                | Version 1                          | `core`                                                               |
| Dynamic and configurable modules          | Version 1                          | Static typed factory returns with explicit instance keys             |
| Singleton, request, transient scopes      | Version 1                          | `core`                                                               |
| Circular dependency diagnostics           | Version 1                          | Reject cycles; no automatic forward-reference escape by default      |
| Module reference create and resolve       | Version 1 restricted               | Infrastructure API only; no business service locator                 |
| Lazy module loading                       | Later                              | Requires type-widening and lifecycle ADR                             |
| Lifecycle and shutdown hooks              | Version 1                          | `core`, `common` platform SPI                                        |
| Discovery and graph inspection            | Version 1                          | `core`, CLI diagnostics                                              |
| Middleware                                | Elysia-native                      | Native plugins and request hooks                                     |
| Guards, pipes, interceptors, filters      | Version 1 adapted                  | Phase-specific HTTP contracts with familiar optional aliases         |
| Global prefix                             | Version 1                          | `http`, `platform-elysia`                                            |
| URI, header, media, and custom versioning | Version 1 where Elysia supports it | Native route metadata and adapter policy                             |
| CORS, cookies, compression, raw body      | Elysia-native with secure policy   | Official plugins plus `security`                                     |
| Sessions                                  | Version 1 optional                 | `auth-session`                                                       |
| Static files and MVC templates            | Later or Elysia-native             | Use Elysia plugins; no core ownership                                |
| File upload and streaming                 | Version 1 contracts                | `http`, `security`; storage adapters later                           |
| HTTPS and multiple servers                | Platform capability                | Explicit Bun adapter capability; multiple-server orchestration later |
| Async-local request context               | Version 1 internal                 | Request context ID; no public dependency on Node AsyncLocalStorage   |
| Hybrid HTTP and microservice applications | Later                              | Requires microservice contracts and inheritance ADR                  |
| REPL                                      | Later                              | CLI package after stable discovery APIs                              |
| Testing and auto-mocking                  | Version 1                          | `testing`, `testing-elysia`                                          |
| Configuration and validation              | Version 1                          | `config`, `validation`                                               |
| Caching, events, scheduling, queues       | Later packages                     | Release wave B                                                       |
| Logging, tracing, metrics, health         | Version 1                          | `observability`, `observability-otel`, `health`                      |
| OpenAPI                                   | Version 1                          | `openapi`                                                            |
| WebSockets                                | Post-version-1                     | `websockets`, Elysia WebSocket subpath                               |
| Microservices, TCP, MQTT, brokers, gRPC   | Post-version-1                     | `microservices` and transport packages                               |
| GraphQL and CQRS                          | Post-version-1                     | Optional packages                                                    |
| ORM and database integrations             | Intentionally external-first       | Lifecycle contracts only; ORM adapters remain optional               |

## 10. Delivery roadmap

Each step is one reviewable pull request and includes its own rollback boundary.

### Step 0: Package scope and naming ADR

Dependencies: None  
Context: Package names become long-lived public contracts.

Tasks:

- Verify that the `@aponiajs` NPM scope can be owned and published.
- Approve package naming, version synchronization, peer ranges, and deprecation policy.
- Record package boundary and forbidden-edge ADRs.
- Define the release and provenance identity.

Verify: Naming review, NPM dry-run metadata validation, and dependency graph fixture.  
Exit: Scope ownership and package names are approved.  
Rollback: Select a different scope before publishing any package.

### Step 1: Workspace package template

Dependencies: Step 0  
Context: All packages need identical Bun and Vite+ behavior.

Tasks:

- Create a reusable package template.
- Add root catalogs and workspace scripts.
- Add package graph, packed-file, export, and declaration checks.
- Add changeset or equivalent release metadata.

Verify: Generate a temporary package, install, check, test, pack, and import it.  
Exit: A generated package passes every repository gate without manual edits.  
Rollback: Keep the current single-package setup.

### Step 2: Extract `@aponiajs/common`

Dependencies: Step 1  
Context: Stable contracts must exist before runtime implementations.

Tasks:

- Implement tokens, descriptors, scopes, lifecycle interfaces, errors, and diagnostics.
- Add public type fixtures and declaration snapshots.
- Enforce zero platform imports.

Verify: Bun tests, Vite+ checks, compile tests, and pack dry run.  
Exit: `common` has no Aponia or Elysia runtime dependency.  
Rollback: Move contracts back to the original package.

### Step 3: Build the core module graph

Dependencies: Step 2  
Context: Graph correctness precedes provider instantiation.

Tasks:

- Implement module identity, imports, exports, visibility, and graph diagnostics.
- Add duplicate, missing, circular, diamond, and configured-module cases.
- Add graph inspector output.

Verify: Graph tests, property tests, and diagnostic snapshots.  
Exit: Module graphs compile deterministically with actionable failures.  
Rollback: Keep descriptors and remove graph compilation exports.

### Step 4: Add singleton provider resolution

Dependencies: Step 3  
Context: Begin DI with one deterministic scope.

Tasks: Implement value, factory, alias, and class providers with explicit dependencies.  
Verify: Singleton resolution, visibility, duplicate, and missing-token tests.  
Exit: A singleton graph resolves without reflection or service locator access.  
Rollback: Retain the graph compiler and remove runtime resolution.

### Step 5: Add async creation and failure cleanup

Dependencies: Step 4  
Context: Async providers need cancellation and partial-bootstrap cleanup.

Tasks: Add async factories, timeout, cancellation, failure paths, and reverse cleanup.  
Verify: Failure injection and deterministic disposal-order tests.  
Exit: Failed bootstrap leaks no provider or resource.  
Rollback: Keep synchronous singleton resolution.

### Step 6: Add request and transient scopes

Dependencies: Step 5  
Context: Additional scopes require explicit ownership.

Tasks: Add context IDs, request scope, transient scope, and scope-leak diagnostics.  
Verify: Scope isolation, concurrent request, alias, and leak tests.  
Exit: Provider ownership is deterministic for every scope.  
Rollback: Disable non-singleton scopes without changing descriptors.

### Step 6A: Add application lifecycle and discovery

Dependencies: Step 6  
Context: Lifecycle ownership builds on stable scope semantics.

Tasks: Add initialization hooks, reverse-topological disposal, and public
discovery contracts.  
Verify: Initialization, disposal, discovery, and failure-order tests.  
Exit: Provider lifecycle and discovery are deterministic under success and failure.  
Rollback: Retain scopes and remove application lifecycle exports.

### Step 6B: Add shutdown and instrumentation contracts

Dependencies: Step 6A  
Context: Process ownership and telemetry require a separately reviewable boundary.

Tasks: Add explicit shutdown coordination, cancellation propagation,
instrumentation interfaces, and idempotent close results without installing
hidden signal handlers.  
Verify: Shutdown race, repeated close, cancellation, and instrumentation tests.  
Exit: Shutdown is bounded and telemetry does not change runtime semantics.  
Rollback: Retain provider lifecycle and remove shutdown and instrumentation exports.

### Step 7: Extract `@aponiajs/platform`

Dependencies: Steps 2 and 6B  
Context: Reusable utilities build on the minimal SPI already defined in `common`.

Tasks: Add adapter bases, capability negotiation, fake adapter, and contract test kit.  
Verify: Boot and close core through the fake adapter; assert no `platform -> core` edge.  
Exit: Platform utilities remain independent from the core implementation.  
Rollback: Keep only the minimal SPI in `common`.

### Step 8: Extract `@aponiajs/http`

Dependencies: Steps 2 and 7  
Context: HTTP descriptors remain transport-neutral.

Tasks: Add controller, route, schema, response, Problem Details, and phase descriptors.  
Verify: Type fixtures, declarations, and zero-Elysia import check.  
Exit: HTTP contracts preserve all information required by a native adapter.  
Rollback: Keep HTTP descriptors private until stable.

### Step 9: Prove native Elysia round-trip compatibility

Dependencies: Steps 4 and 8  
Context: Validate the user's central requirement before building the full adapter.

Tasks:

- Consume unchanged instance, functional, deferred, lazy-import, and supported
  tuple plugin forms from an Aponia module.
- Compile one Aponia module into an Elysia plugin.
- Use that compiled module from an existing raw Elysia application.
- Prove one-time registration and module-to-controller context inference.
- Compose Aponia async provider readiness with Elysia's module barrier.

Verify: Positive and negative compile tests, execution-count fixtures,
`app.modules`, immediate `app.handle(Request)`, async failure cleanup, raw-host
listen and shutdown, and an Eden Treaty fixture.  
Exit: Both integration directions work without plugin or route reimplementation.  
Rollback: Keep the proof as an experiment and do not publish adapter APIs.

### Step 10: Add native-plugin type accumulation

Dependencies: Step 9  
Context: Establish canonical registration and type ordering before controller DI.

Tasks: Implement ordered native-plugin tuples and exact context accumulation for
all supported Elysia `.use()` input forms.  
Verify: Instance, function, deferred, lazy, tuple, unnamed, named, configured,
stateful, and explicit-duplicate compile and execution-count fixtures.  
Exit: Each declaration registers once and preserves native inferred context.  
Rollback: Retain the Step 9 vertical slice.

### Step 10A: Add the controller and service bridge

Dependencies: Step 10  
Context: Add Nest-style structure without hiding DI inside native handlers.

Tasks: Implement the typed module controller builder, explicit service injection,
and module visibility rules over the accumulated native context.  
Verify: Controller context, provider visibility, request scope, and negative
injection compile fixtures.  
Exit: Modules, services, and controllers compose without a second plugin registration.  
Rollback: Keep native accumulation and remove the controller bridge.

### Step 10B: Add the route and schema compiler

Dependencies: Step 10A  
Context: Route emission and schema inference deserve an isolated review.

Tasks: Compile route descriptors, macros, models, request schemas, response
schemas, status types, and prefix ordering to native Elysia declarations.  
Verify: Macro, model, derive, response, route-order, and Eden Treaty fixtures.  
Exit: Mixed native and Aponia routes preserve exact public types.  
Rollback: Retain module/controller typing without publishing route compilation.

### Step 10C: Document and enforce the dynamic inference boundary

Dependencies: Step 10B  
Context: Runtime discovery cannot promise static route inference.

Tasks: Add typed dynamic-module factories, intentional widening diagnostics, and
declaration tests that reject accidental `any` or record flattening.  
Verify: Static, typed-factory, and intentionally dynamic declaration fixtures.  
Exit: Every widening point is explicit, documented, and mechanically tested.  
Rollback: Support statically declared modules only.

### Step 11: Map registration and scope semantics

Dependencies: Steps 6B and 10C  
Context: Local, scoped, and global behavior must remain native.

Tasks: Map registration order, local/scoped/global propagation, request context
ownership, and short-circuit-neutral scope creation.  
Verify: Registration-order and plugin-scope conformance matrix.  
Exit: Native Elysia scope behavior remains authoritative and observable.  
Rollback: Keep typed routes and allow local scope only.

### Step 11A: Map short circuits, errors, and responses

Dependencies: Step 11  
Context: Response control flow can terminate at multiple Elysia phases.

Tasks: Map validation failures, early returns, thrown errors, Problem Details,
native responses, result transforms, and response serialization.  
Verify: Phase-by-phase short-circuit, error, and response matrix.  
Exit: Every response path has a documented native phase and stable error result.  
Rollback: Retain scope mapping and native Elysia error behavior.

### Step 11B: Add cleanup, abort, and disposal mapping

Dependencies: Step 11A  
Context: Resource ownership must survive failures and client cancellation.

Tasks: Connect abort propagation, request-scope cleanup, stream cancellation,
provider disposal, async readiness failure, and idempotent shutdown ordering.  
Verify: Abort, timeout, failure injection, stream cleanup, and disposal-order tests.  
Exit: No request, provider, or readiness resource leaks on any terminal path.  
Rollback: Disable request-scoped resources in the adapter.

### Step 11C: Add trace integration

Dependencies: Step 11B  
Context: Tracing must observe native lifecycle without altering it.

Tasks: Map trace extraction, phase spans, error status, response completion, and
instrumentation hooks to the platform-neutral contracts.  
Verify: Trace ordering, disabled instrumentation, and error-path snapshots.  
Exit: Tracing adds no registration, type, or control-flow differences.  
Rollback: Remove trace hooks while retaining lifecycle correctness.

### Step 12: Add Elysia server ownership

Dependencies: Step 11C  
Context: Listening, draining, aborts, and streaming need separate operational review.

Tasks: Add listen, address, native handle, stop, drain, abort, streaming, SSE,
limits, and shutdown results without hidden signal handlers.  
Verify: Load, abort, stream cleanup, and graceful-shutdown tests.  
Exit: Server lifecycle is bounded and leak-free.  
Rollback: Support `app.handle(Request)` only.

### Step 13: Publish `@aponiajs/testing`

Dependencies: Steps 6B and 7  
Context: Core-only testing must not require Elysia.

Tasks: Add test modules, provider and module overrides, fake platform, auto-mocking,
controlled context IDs, fake clock, lifecycle assertions, and leak detection.  
Verify: Core-only public testing fixtures.  
Exit: Tests use no private container access or Elysia dependency.  
Rollback: Keep helpers internal to core.

### Step 14: Publish `@aponiajs/testing-elysia`

Dependencies: Steps 12 and 13  
Context: Elysia helpers belong behind explicit peers.

Tasks: Add typed test application, request client, plugin fixtures, and policy,
transform, response, error, and global-enhancer overrides.  
Verify: Native plugin and Aponia controller integration fixtures.  
Exit: Core testing consumers resolve no Elysia declaration.  
Rollback: Keep Elysia helpers in adapter tests only.

### Step 15: Publish `@aponiajs/config`

Dependencies: Steps 6B and 13  
Context: Configuration must fail safely before listen.

Tasks: Add typed sources, validation, namespaces, secret references, and safe diagnostics.  
Verify: Invalid, async, secret-redaction, and packed-consumer tests.  
Exit: Invalid configuration prevents bootstrap without leaking values.  
Rollback: Applications use Bun environment APIs directly.

### Step 16: Publish `@aponiajs/validation`

Dependencies: Steps 8, 10C, and 14  
Context: Validation must remain Elysia-native and type preserving.

Tasks: Add transformation and unknown-field policies around native schemas.  
Verify: Malformed, oversized, coercion, response, and compile tests.  
Exit: Validation preserves controller and Eden inference.  
Rollback: Applications use native Elysia schemas directly.

### Step 17: Publish `@aponiajs/security`

Dependencies: Steps 12, 15, and 16  
Context: Secure HTTP defaults need explicit ownership.

Tasks: Add trusted proxy, host, CORS, headers, cookies, size limits, raw-body,
compression, upload, TLS, and opt-out policy.  
Verify: Security abuse corpus and secure-default snapshots.  
Exit: Every opt-out requires an explicit rationale and diagnostic.  
Rollback: Applications configure official Elysia plugins directly.

### Step 18: Publish `@aponiajs/serialization`

Dependencies: Steps 10B and 16  
Context: Output mapping is independent from authentication.

Tasks: Add projection, redaction, dates, binary, and status-specific serialization.  
Verify: Schema, redaction, stream, and packed-consumer tests.  
Exit: Serialization cannot expose excluded or secret fields.  
Rollback: Use native Elysia response mapping.

### Step 19: Publish `@aponiajs/auth`

Dependencies: Steps 6B, 10A, and 17  
Context: Stabilize principal and policy contracts before implementations.

Tasks: Add credentials, principal, authentication result, policy evaluator, and
default-deny authorization contracts.  
Verify: Policy composition and request-scope tests.  
Exit: Contracts contain no JWT, session, or platform implementation.  
Rollback: Keep authentication application-local.

### Step 20: Publish `@aponiajs/auth-jwt`

Dependencies: Step 19  
Context: JWT and JWKS are optional implementations.

Tasks: Add algorithm, claims, issuer, audience, JWKS, rotation, timeout, cache,
and unknown-key policies.  
Verify: Rotation, stampede, timeout, and malformed-token corpus.  
Exit: No decode-only authentication path exists.  
Rollback: Remove the implementation without changing auth contracts.

### Step 21: Publish `@aponiajs/auth-session`

Dependencies: Steps 17 and 19  
Context: Cookie sessions require distinct CSRF and fixation controls.

Tasks: Add signing, secure cookies, CSRF, renewal, revocation, and fixation prevention.  
Verify: Session abuse and cross-site request corpus.  
Exit: Mutation routes are protected under the documented cookie policy.  
Rollback: Remove the implementation without changing auth contracts.

### Step 22: Publish rate limiting

Dependencies: Steps 17 and 19  
Context: Limiter identity follows trusted proxy and optional authentication.

Tasks: Publish `rate-limit` contracts and in-memory store. Defer Redis to a
separate adapter pull request after contract approval.  
Verify: Atomicity, cardinality, outage, and load tests.  
Exit: Identity, fail-open, fail-closed, and retry semantics are explicit.  
Rollback: Remove the limiter module.

### Step 23: Publish observability

Dependencies: Steps 6B, 11C, and 15  
Context: Stabilize contracts before choosing an exporter.

Tasks: Publish logger, trace, metric, redaction, and request-ID contracts.  
Verify: Trace context, bounded labels, redaction corpus, and fake-exporter tests.  
Exit: Core does not import an exporter.  
Rollback: Keep observability application-local.

### Step 23A: Publish `@aponiajs/observability-otel`

Dependencies: Step 23  
Context: OpenTelemetry is an optional implementation.

Tasks: Integrate the official Elysia OpenTelemetry plugin and OTLP exporters.  
Verify: Trace continuity, propagation, failure, shutdown, and OTLP fixture tests.  
Exit: Removing the package leaves observability contracts intact.  
Rollback: Remove the exporter package.

### Step 24: Publish `@aponiajs/health`

Dependencies: Steps 12, 15, and 23  
Context: Health reflects real bootstrap and drain lifecycle.

Tasks: Add liveness, readiness, startup, dependency indicators, and drain transitions.  
Verify: Startup failure, dependency outage, and shutdown timing tests.  
Exit: Readiness changes before traffic drain begins.  
Rollback: Applications implement native health routes.

### Step 25: Publish `@aponiajs/openapi`

Dependencies: Steps 10B, 16, and 17  
Context: Consume preserved metadata without rescanning handlers.

Tasks: Aggregate native Elysia schemas, security, versions, and operation metadata.  
Verify: OpenAPI snapshots, official plugin compatibility, and generated-client tests.  
Exit: Mixed native and Aponia routes produce one accurate document.  
Rollback: Use the official Elysia OpenAPI plugin directly.

### Step 26: Publish optional decorators

Dependencies: Steps 2, 8, and 10A  
Context: Syntax sugar cannot add runtime capabilities.

Tasks: Emit immutable functional descriptors for modules, providers, controllers,
routes, injection, and lifecycle.  
Verify: Functional parity, declarations, and bootstrap benchmark.  
Exit: No runtime reflection scan and no decorator-only behavior.  
Rollback: Do not publish the optional package.

### Step 27: Publish `create-aponia`

Dependencies: Steps 1 through 25  
Context: A starter should generate only stable public APIs.

Tasks: Add minimal, authentication, and OpenAPI Bun project templates.  
Verify: Generate, frozen install, check, test, build, start, and close.  
Exit: Every template passes the supported Bun matrix.  
Rollback: Keep templates in documentation.

### Step 28: Publish the CLI diagnostic core

Dependencies: Steps 3, 25, and 27  
Context: Graph and AST tooling need stable descriptors.

Tasks: Publish `doctor`, `graph`, and version compatibility diagnostics.  
Verify: Graph snapshots and clean generated-project diagnostics.  
Exit: Diagnostics use public inspection APIs only.  
Rollback: Retain only `create-aponia`.

### Step 28A: Publish `@aponiajs/schematics`

Dependencies: Step 28  
Context: Source generation needs independent AST safety review.

Tasks: Add AST-safe module, service, controller, and capability generators.  
Verify: Golden-file, idempotency, migration, and generated-project tests.  
Exit: Repeated generation never corrupts source.  
Rollback: Retain CLI diagnostics without generators.

### Step 29: Foundation release candidate

Dependencies: Steps 0 through 28A  
Context: Publish the stable HTTP foundation before additional transports.

Tasks: Run API signature, compatibility, native Elysia plugin, security,
performance, registry, provenance, and clean-consumer reviews.  
Verify: Registry smoke tests, SBOM, attestation, audits, and benchmark thresholds.  
Exit: No unresolved critical or high finding and no package graph violation.  
Rollback: Keep release-candidate tags and do not promote stable.

Post-version-1 infrastructure and transport packages are separate roadmap
programs. Every contract package and every driver is a separate pull request
with its own adapter fixture and rollback boundary.

## 11. Release waves

| Milestone            | Packages                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| M0 Contracts         | `common`                                                                                                                  |
| M1 Core              | `core`, `platform`                                                                                                        |
| M2 HTTP alpha        | `http`, `platform-elysia`, `testing`, `testing-elysia`                                                                    |
| M3 Production beta   | `config`, `validation`, `serialization`, `security`, auth packages, rate-limit packages, observability packages, `health` |
| M4 Developer preview | `openapi`, `decorators`, `cli`, `schematics`, `create-aponia`                                                             |
| M5 Version 1         | Stable foundation and production HTTP packages                                                                            |
| M6 Ecosystem         | Cache, events, schedule, queues, persistence, WebSockets, microservices, TCP, MQTT, broker transports, GraphQL, CQRS      |

Do not publish all package placeholders at once. Publish only packages with a
stable contract, tests, documentation, and a real reference application.

## 12. Global acceptance gates

Every package pull request must pass:

```bash
bun install --frozen-lockfile
bun run check
bun test
bun run test:vite-plus
bun run build
bun --cwd packages/<changed-package> pm pack --dry-run
bun --cwd packages/<changed-package> publish --dry-run
```

Additional gates:

- No Thai Unicode characters in repository files.
- No forbidden dependency edges.
- No duplicate foundation package instances in a consumer fixture.
- No exported `any`.
- No hidden runtime reflection scan.
- No Elysia import from `common`, `core`, `platform`, or `http`.
- No Node-only API without an approved Bun compatibility ADR.
- `bun pm scan` and `bun pm untrusted` review.
- Secret scanning, license policy, and packed dependency inventory.
- Reproducible tarball hash comparison where platform metadata permits it.
- A documented vulnerability disclosure, release revocation, and dependency
  update policy.
- No package publish without README, LICENSE, exports, declaration, provenance,
  and clean-install tests.

## 13. Plan mutation protocol

1. Record package boundary changes in an ADR.
2. Update dependency edges and peer ranges before implementation.
3. Split any step that exceeds one reviewable pull request.
4. Never merge platform implementation into `core` for convenience.
5. Never publish an empty package to reserve a name.
6. Preserve deprecated exports for the documented deprecation window.
7. Keep all persisted plans, ADRs, code comments, and documentation in English.

## 14. Primary references

- [NestJS package layout](https://github.com/nestjs/nest/tree/master/packages)
- [NestJS core package structure](https://github.com/nestjs/nest/tree/master/packages/core)
- [NestJS capability map](https://docs.nestjs.com/introduction)
- [NestJS request lifecycle](https://docs.nestjs.com/faq/request-lifecycle)
- [NestJS custom providers](https://docs.nestjs.com/fundamentals/custom-providers)
- [NestJS injection scopes](https://docs.nestjs.com/fundamentals/injection-scopes)
- [NestJS platform agnosticism](https://docs.nestjs.com/fundamentals/platform-agnosticism)
- [NestJS testing](https://docs.nestjs.com/fundamentals/testing)
- [NestJS microservices](https://docs.nestjs.com/microservices/basics)
- [NestJS custom transporters](https://docs.nestjs.com/microservices/custom-transport)
- [NestJS WebSocket adapters](https://docs.nestjs.com/websockets/adapter)
- [Elysia plugin and scope model](https://elysiajs.com/essential/plugin)
- [Elysia lifecycle](https://elysiajs.com/essential/life-cycle)
- [Elysia official plugins](https://elysiajs.com/plugins/overview)
- [Bun workspaces](https://bun.sh/docs/pm/workspaces)
- [Bun package publishing](https://bun.sh/docs/pm/cli/publish)
- [NPM provenance](https://docs.npmjs.com/generating-provenance-statements/)
