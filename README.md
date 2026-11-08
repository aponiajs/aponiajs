# AponiaJS

A structured TypeScript framework for Bun and Elysia, built for applications
that need clear module boundaries, strong runtime validation, and a stable
foundation across HTTP, WebSockets, messaging, and serverless delivery.

[![CI](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml/badge.svg)](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml)
[![CLI npm version](https://img.shields.io/npm/v/%40aponiajs%2Fcli/beta?label=CLI)](https://www.npmjs.com/package/@aponiajs/cli)
[![Bun](https://img.shields.io/badge/Bun-1.4.2-black)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

[Quick start](#quick-start) · [CLI](#cli) · [Capabilities](#capabilities) ·
[Documentation](#documentation) · [Examples](./examples/README.md)

> AponiaJS is in beta; the CLI badge above reports the current prerelease. The
> public API may change before the first stable release. Production deployments
> should pin an exact version and review the
> [stability policy](./docs/stability.md).

## Overview

AponiaJS separates the authoring surface from the runtime that executes it.
Decorators such as `@Module()`, `@Controller()`, and `@Injectable()` write
metadata; the platform lowers that metadata into immutable descriptors, then
compiles one module graph, one container, and one route table. Applications may
also declare descriptors directly and skip decorators entirely, which keeps the
same runtime available to generated code and tooling.

The framework is organized as small, separately published packages that share
one synchronized release version:

| Layer                 | Packages                                                                                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime               | `@aponiajs/common`, `@aponiajs/core`, `@aponiajs/platform-elysia`                                                                                                                                                                                                                                    |
| Tooling               | `@aponiajs/cli`, `create-aponia`, `@aponiajs/devtools`, `@aponiajs/testing`                                                                                                                                                                                                                          |
| Platform integrations | `@aponiajs/graphql`, `@aponiajs/openapi`, `@aponiajs/mcp`, `@aponiajs/cors`, `@aponiajs/cron`, `@aponiajs/opentelemetry`                                                                                                                                                                             |
| Application services  | `@aponiajs/auth`, `@aponiajs/audit`, `@aponiajs/cache`, `@aponiajs/compression`, `@aponiajs/database`, `@aponiajs/events`, `@aponiajs/http`, `@aponiajs/idempotency`, `@aponiajs/metrics`, `@aponiajs/queue`, `@aponiajs/rate-limit`, `@aponiajs/security`, `@aponiajs/session`, `@aponiajs/tenancy` |
| Delivery              | `@aponiajs/microservices`, `@aponiajs/serverless`                                                                                                                                                                                                                                                    |

The [package catalog](./docs/packages.md) documents every package and its
runtime dependencies.

## Requirements

- [Bun](https://bun.sh) 1.4.2 or later.
- Elysia `2.0.0-beta.24` as the HTTP peer for `@aponiajs/platform-elysia`.
- TypeScript with `experimentalDecorators` and `emitDecoratorMetadata` when an
  application uses decorators. The CLI starter configures both.

## Quick start

Create an application, generate a REST resource, and start the development
server:

```bash
bun add --global @aponiajs/cli@beta
aponia new my-api
cd my-api
aponia generate resource users --type rest
aponia build
bun run dev
```

`aponia generate` writes the resource and registers it in `AppModule`.
`aponia build` regenerates the route invokers and module descriptors the
application boots from; without that step, newly generated routes are not
mounted because the committed descriptors define the module graph.

The application listens on `http://localhost:3000`. The generated service keeps
data in memory, so the collection resets when the process restarts.

```bash
curl http://localhost:3000/users
curl -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Ada"}'
```

The starter also serves `GET /` and mounts opt-in development tooling under
`/__devtools`. `GET /__devtools/meta` reports the contract version, framework
release, and the artifacts the running boot adopted.

## Generated project layout

`aponia new` creates a Bun application with configuration, tests, and build
scripts. A generated REST resource follows the same layout as the rest of the
application:

| File                                | Responsibility                             |
| ----------------------------------- | ------------------------------------------ |
| `src/users/users.controller.ts`     | HTTP routes and request binding            |
| `src/users/users.service.ts`        | Application behavior                       |
| `src/users/users.model.ts`          | Create, update, and path validation models |
| `src/users/users.module.ts`         | Feature registration                       |
| `src/users/entities/user.entity.ts` | Resource entity                            |

Generated files are ordinary application code. They carry no framework-only
abstractions that prevent refactoring toward the domain model.

## CLI

| Command                                        | Purpose                                            |
| ---------------------------------------------- | -------------------------------------------------- |
| `aponia new my-api`                            | Create an application and install dependencies.    |
| `aponia g resource users --type rest`          | Generate a REST resource with CRUD routes.         |
| `aponia g resource orders --type microservice` | Generate a message-pattern controller.             |
| `aponia g module billing`                      | Add a module.                                      |
| `aponia g controller billing`                  | Add an HTTP controller.                            |
| `aponia g service billing`                     | Add an injectable service.                         |
| `aponia g gateway events`                      | Add a WebSocket gateway provider.                  |
| `aponia g library widgets --publish`           | Add a publishable library package.                 |
| `aponia library check packages/widgets`        | Validate a library's manifest and contract.        |
| `aponia library search security`               | Search the bundled library catalog.                |
| `aponia manifest`                              | Print the machine-readable framework contract.     |
| `aponia mcp`                                   | Start the read-only project MCP server over stdio. |
| `aponia agent init`                            | Install Codex, Claude Code, and Cursor guidance.   |
| `aponia build`                                 | Regenerate route invokers and module descriptors.  |

`g` is an alias for `generate`. Generated components are registered in the
nearest module by default; `--module <name>` selects a module and
`--skip-import` leaves registration to the caller. `--dry-run` previews every
write, and `--no-spec` skips generated tests.

Resource transports are `rest`, `graphql-code-first`, `graphql-schema-first`,
`microservice`, and `ws`. REST resources mount a controller with validated
request models; microservice resources mount a controller whose methods carry
`@MessagePattern()` handlers; WebSocket resources mount a provider-registered
gateway. GraphQL resources emit an unconnected resolver scaffold because the
GraphQL package takes a schema factory rather than a decorator layer.

The [CLI guide](./docs/cli.md) documents every command, option, and generated
file.

## Capabilities

### Core runtime

- Modules, imports, exports, `@Global()` modules, and `forwardRef()` for
  circular module references.
- Constructor and property injection with class, value, factory, and alias
  providers; explicit tokens; `@Optional()` dependencies; `ModuleRef` for
  resolving providers from the active container.
- `DEFAULT`, `REQUEST`, and `TRANSIENT` provider scopes, with request-scoped
  services backed by `RequestContextModule`.
- Fail-fast graph validation: duplicate modules and providers, import cycles,
  unexported tokens, unresolved dependencies, and ambiguous imports are refused
  before any instance is created.
- Provider and application lifecycle hooks, standalone application contexts
  for workers and CLIs, and `LazyModuleLoader` for modules compiled after boot.

### HTTP and routing

- Decorated controllers and routes, with a descriptor API for generated code
  and tooling.
- Route validation through Standard Schema (Zod, Valibot, ArkType), TypeBox,
  or native Elysia validators, with one-schema-per-class validation models for
  create, update, and path-parameter contracts.
- Parameter decorators for body, query, path parameters, headers, cookies,
  request state, response settings, and HTTP status.
- Guards, interceptors, exception filters, parameter pipes, and route
  middleware compiled into per-route lifecycle hooks.
- RFC 9457 Problem Details for application errors, with a default mapping that
  never serializes a stack or cause.
- Response serialization (`@Serialize()`), Server-Sent Events (`@Sse()`),
  multipart upload binding, and route deprecation headers (`@Deprecated()`).
- API versioning from the URI, a request header, or an `Accept` parameter.
  `@Version()` mounts the versioned path and the negotiation layer rewrites the
  request before routing, so the selected route runs its own hooks and
  validation.

### Security

- Bearer JWT authentication with OIDC discovery, role and permission guards,
  `@Public()` routes, refresh-token rotation, and access-token revocation over
  injectable stores.
- Signed sessions with `SessionService`, signed `HttpOnly` cookies, and a
  bounded pluggable store.
- Security response headers and opt-in signed double-submit CSRF protection.
- Fixed-window request rate limiting with standard headers, route overrides,
  and `429` Problem Details responses.
- SSRF-safe outbound HTTP with private-network blocking, redirect
  re-validation, timeouts, bounded responses, and idempotent retries.
- Bounded, redacting audit events and request-scoped multi-tenancy with an
  explicit required/optional tenant policy.
- The [threat model](./docs/threat-model.md) states what the framework defends
  against and which controls a deployment still owns.

### Reliability and operations

- Health probes for liveness and readiness, plus graceful shutdown with
  ordered module teardown and an opt-in signal installer.
- A bounded Prometheus registry, request instrumentation, and a scrape endpoint
  mounted on the application's own route table.
- OpenTelemetry tracing through a validated configuration; the application
  supplies its SDK, exporters, and instrumentations.
- An in-process job queue with bounded retries, exponential backoff, a dead
  letter queue, job timeouts, pause/resume, idempotent enqueue, and a pluggable
  durable store contract.
- An outbox service that delivers recorded messages after a transaction, with
  in-process delivery and an application-supplied store.
- Idempotent request replay with body fingerprinting, conflict detection, and a
  pluggable store.
- A bounded application cache with TTL, prefix isolation, single-flight
  `wrap()`, and a pluggable store.

### Data and messaging

- A Drizzle-first database boundary with an explicit transaction API, typed
  repositories, and ordered SQL migrations; the application owns the database
  handle and the dialect.
- Typed in-process events with ordered awaitable handlers, `@OnEvent()`
  listeners, and aggregate failure reporting.
- Message-pattern microservices with `@MessagePattern()` for request/response,
  `@EventPattern()` for fire-and-forget delivery, `@Payload()` binding, and a
  transport contract. `@aponiajs/microservices` ships an in-memory reference
  transport; a broker transport implements the same three members.
- WebSocket gateways with payload validation, handshake guards, origin
  allowlists, payload limits, idle timeouts, and lifecycle hooks.

### Deployment and integration

- Web Fetch and AWS Lambda adapters for API Gateway payload 2.0 and 1.0,
  including cookies, multi-value headers, and base64 bodies.
- Native Elysia plugins, Eden Treaty type inference, and a supported escape
  hatch to the underlying Elysia instance.
- OpenAPI document generation, GraphQL endpoints, CORS policy, scheduled jobs,
  and an opt-in devtools surface served by the running application itself.
- A Model Context Protocol server that supports the `2024-11-05` through
  `2025-11-25` handshake revisions and answers `server/discover`. Full
  `2026-07-28` compliance, including multi round-trip requests and cache hints,
  is not claimed.

## Operational limits

The default stores for sessions, rate limits, cache, refresh tokens,
revocations, the queue backlog, and idempotency are process-local. A deployment
with more than one instance supplies shared implementations of the published
store contracts. The queue is not a broker: a durable store preserves a backlog
across restarts, and a broker adapter is responsible for claiming work across
consumers.

## Documentation

- [Learning path](./docs/learn/README.md) — an ordered introduction to the
  framework.
- [Dependency injection](./docs/dependency-injection.md) and
  [validation](./docs/learn/06-validation.md).
- [WebSockets](./docs/websockets.md), [microservices](./docs/microservices.md),
  and [serverless deployment](./docs/deployment.md).
- [Queues](./docs/queues.md), [database](./docs/database.md),
  [metrics](./docs/metrics.md), and [OpenAPI](./docs/openapi.md).
- [Security policy](./SECURITY.md) and the
  [threat model](./docs/threat-model.md).
- [Migrating from NestJS](./docs/migrating-from-nest.md) and the
  [package catalog](./docs/packages.md).

## Development

```bash
bun install
bun run check              # format, lint, and type-check
bun run test:coverage      # Bun suite with the 95% coverage floor
bun run test:vite-plus     # Vite+ conformance suite
bun run test:examples      # example applications end to end
bun run build              # build every workspace package
bun run api:verify         # compare the public API with docs/public-api.json
bun run release:dry-run    # verify publishable package contents
```

The repository guide ([`AGENTS.md`](./AGENTS.md)) defines ownership and
architecture invariants; [`RULES.md`](./RULES.md) defines the verification and
coding rules. Read both before changing framework code.

## Contributing

This repository is the framework itself, not an application built with it.
Changes become published npm packages and are treated as public API work. Start
with [`AGENTS.md`](./AGENTS.md) and the
[release guide](./docs/releasing.md), then run `bun run check`,
`bun run test:coverage`, and `bun run test:vite-plus` before submitting.

## License

AponiaJS is available under the [MIT License](./LICENSE).
