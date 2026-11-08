<div align="center">

<img src="./assets/aponia-mascot.png" alt="The AponiaJS mascot: a winged figure in a laurel crown" width="240" />

# AponiaJS

**A structured TypeScript framework for Bun and Elysia.**

Create an application, add a feature, and keep its architecture clear as it grows.

[![CI](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml/badge.svg)](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml)
[![CLI on npm](https://img.shields.io/npm/v/%40aponiajs%2Fcli/beta?label=CLI%20%28beta%29&color=c3a7dc)](https://www.npmjs.com/package/@aponiajs/cli)
[![Bun](https://img.shields.io/badge/Bun-1.4.2-f8eddd?logo=bun&logoColor=24232d)](https://bun.sh)
[![MIT License](https://img.shields.io/badge/license-MIT-f3d5de)](./LICENSE)

[Quick start](#quick-start) · [CLI commands](#cli-commands) · [Documentation](#documentation) · [Examples](./examples/README.md)

<sub>Currently in beta. AponiaJS is not recommended for production use yet.</sub>

<sub>Release v1 · codename tanya</sub>

</div>

## Quick start

Install [Bun](https://bun.sh), then use the CLI to create an application and add
a REST resource:

```bash
bun add --global @aponiajs/cli@beta
aponia new my-api
cd my-api
aponia generate resource users --type rest
aponia build
bun run dev
```

`aponia generate` writes the resource and registers it in `AppModule`, and
`aponia build` refreshes the route invokers and module descriptors the
application boots from. Without that refresh the generated routes are not
mounted, because the committed descriptors are the whole module graph.

The application starts at `http://localhost:3000`. In another terminal, try
the generated routes:

```bash
curl http://localhost:3000/users
curl -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Ada"}'
```

`GET /users` starts with an empty collection. `POST /users` creates an item
with an ID. The generated service stores data in memory, so the collection
resets when the application restarts.

The starter also serves `GET /` and mounts the development tools under
`/__devtools`: [`GET /__devtools/meta`](http://localhost:3000/__devtools/meta)
reports the contract version, framework release, and artifacts its boot adopted.
You can create the same starter with `bun create aponia@beta my-api`.

## What the CLI creates

`aponia new` prepares a Bun application, installs its dependencies, and adds
configuration, tests, and build scripts. The REST resource command creates a
feature under `src/users/` and registers its module in `AppModule`.

| File                                | Responsibility                      |
| ----------------------------------- | ----------------------------------- |
| `src/users/users.controller.ts`     | HTTP routes and request handling    |
| `src/users/users.service.ts`        | Application behavior                |
| `src/users/users.model.ts`          | Create, update, and path validation |
| `src/users/users.module.ts`         | Feature registration                |
| `src/users/entities/user.entity.ts` | Resource entity                     |

The resource also includes controller and service tests. Its generated files
are ordinary application code that you can adapt to your domain.

## CLI commands

| Command                                 | Purpose                                                  |
| --------------------------------------- | -------------------------------------------------------- |
| `aponia new my-api`                     | Create an application and install dependencies.          |
| `aponia g res users --type rest`        | Generate a REST resource with CRUD routes.               |
| `aponia g module billing`               | Add a module.                                            |
| `aponia g controller billing`           | Add an HTTP controller.                                  |
| `aponia g service billing`              | Add an injectable service.                               |
| `aponia g gateway events`               | Add a WebSocket gateway provider.                        |
| `aponia g library widgets --publish`    | Add a publishable library package.                       |
| `aponia library check packages/widgets` | Validate a library's package and contract.               |
| `aponia library search security`        | Search the bundled library catalog.                      |
| `aponia manifest`                       | Print the framework contract for agents and tools.       |
| `aponia mcp`                            | Start the read-only project MCP server over stdio.       |
| `aponia agent init`                     | Install Codex, Claude Code, and Cursor guidance.         |
| `aponia build`                          | Refresh generated route invokers and module descriptors. |
| `aponia --help`                         | List commands and options.                               |

`g` is short for `generate`. The CLI registers generated components in the
nearest module by default. Use `--module <name>` to select a module, or
`--skip-import` to handle registration yourself. Add `--no-spec` to skip
generated tests.

Use `--dry-run` to preview `new`, `generate`, or `build` without writing
files. `aponia new my-api --skip-install` creates the project without running
`bun install`. The [complete CLI guide](./docs/cli.md) covers every schematic, `bun run
docs:build` renders the whole documentation set into a static site, and
`bun run api:verify` holds the published exports to `docs/public-api.json`.
alias, option, and supported resource transport. GraphQL and microservice
commands currently generate scaffolds; their runtimes are outside this release.

## Work with a generated application

The starter includes these scripts:

```bash
bun run dev       # run with file watching
bun test          # run unit tests
bun run test:e2e  # run the starter end-to-end test
bun run check     # format, lint, and type-check
bun run build     # refresh generated code and bundle
```

`bun run build` refreshes the starter's committed route invoker and module
descriptor files before bundling; `aponia build` refreshes the same two files
without bundling. `bun run dev` serves the routes those files describe, so run
one of them after generating a resource — otherwise its routes are not mounted.

## Framework capabilities

- **Modules and dependency injection** organize controllers and providers by
  feature, with explicit exports, provider scopes (`DEFAULT`, `REQUEST`, `TRANSIENT`), `@Global()` modules, and `forwardRef()`.
- **Decorated HTTP routes** keep request handling in controllers and application
  behavior in services.
- **Response serialization** provides `@Serialize()` on a controller or handler, applied after interceptors and after the handler.
- **URI API versioning** provides `@Version()` on a controller or handler, mounting routes under `/v<version>`.
- **Server-Sent Events** provide `@Sse()` plus the `sse()` payload helper for event-stream routes.
- **Multipart uploads** are native body values, with `@UploadedFile()` and `@UploadedFiles()` aliases over the validated body.
- **Strict code generation** lets an application refuse a route with no compiled invoker instead of falling back to runtime code generation.
- **Lazy modules** load a module graph after boot, run its provider hooks, and expose an explicit `close()`.
- **Authentication and authorization** provide bearer JWT verification, `AuthGuard`, `RolesGuard`, `PermissionsGuard`, `Public()`, request-scoped current user, refresh-token rotation, access-token revocation, and Bun-native password hashing.
- **Audit events** provide a bounded, redacting `AuditService` and a pluggable store for security and business records.
- **Multi-tenancy** provides a request-scoped `TenantService`, `TenantGuard`, safe tenant identifiers, and an explicit required/optional policy.
- **Jobs and outbox** provide an in-process `QueueService` with bounded retries, exponential backoff, a dead letter queue, and idempotent enqueue, plus an `OutboxService` that delivers recorded messages after a transaction.
- **Metrics** provide a bounded Prometheus registry, `http_requests_total` and `http_request_duration_seconds` instrumentation, and a scrape endpoint mounted on the application's own route table.
- **Idempotency** provides `IdempotencyModule`, which replays a mutating request against its key, refuses a key reused with a different body, and stores answers through a pluggable contract.
- **Database** provides a Drizzle-first `DatabaseService` transaction boundary, a typed `createRepository`, and ordered SQL migrations applied during initialization; the application constructs the database and picks the dialect.
- **Route validation** accepts Elysia validators, TypeBox, and
  [Standard Schema](https://standardschema.dev) implementations (Zod, Valibot, ArkType).
- **Execution Enhancers & Pipes** provide guards, interceptors, exception filters, parameter pipes (`PipeTransform`, `@UsePipes()`), and route middleware (`AponiaMiddleware`).
- **Bounded application caching** provides `CacheService` with TTL, a prefixed key space, and a pluggable store; the default memory store is capped and evicts the oldest insertion.
- **Typed application events** provide an in-process `EventEmitter` with ordered awaitable handlers, `@OnEvent()` listeners, and aggregate handler-error reporting.
- **Request rate limiting** provides `RateLimitGuard`, route overrides, standard `RateLimit-*` headers, and a bounded pluggable store with `429` Problem Details refusals.
- **SSRF-safe outbound HTTP** provides `HttpService` with private-network blocking, redirect re-validation, timeouts, bounded responses, idempotent retries, and Standard Schema validation.
- **Security headers and CSRF** provide conservative response headers by default and opt-in signed double-submit CSRF protection for cookie-based routes.
- **Signed sessions** provide a `SessionService` with start, update, read, and destroy operations, a signed `HttpOnly` cookie, and a bounded pluggable store.
- **Brotli/gzip compression** negotiates `Accept-Encoding`, compresses only compressible bodies above a threshold, and appends `Vary: Accept-Encoding`.
- **Standalone application contexts** boot the provider graph without an HTTP listener for workers, command-line tasks, and container tests.
- **Synchronous & Asynchronous Configuration** safely loads and validates process environment variables or dynamic remote secrets at boot.
- **Native Elysia access & Eden Treaty** supports native plugins, WebSockets, and end-to-end type inference alongside Aponia's decorators and descriptors.

## Documentation

Follow the [learning path](./docs/learn/README.md) for a guided introduction.
For specific topics, see the [CLI guide](./docs/cli.md),
[dependency injection](./docs/dependency-injection.md),
[validation](./docs/learn/06-validation.md), [WebSockets](./docs/websockets.md),
[native plugins](./docs/native-plugins.md), [jobs and outbox](./docs/queues.md),
[database](./docs/database.md), [metrics](./docs/metrics.md), [deployment](./docs/deployment.md), and
[migrating from NestJS](./docs/migrating-from-nest.md). The
[package catalog](./docs/packages.md) describes the published packages.
Security policy and the [threat model](./docs/threat-model.md) describe what the
framework defends against and what a deployment still owns.

## Run the CLI from this checkout

To try local CLI changes, invoke its Bun entrypoint directly. From the
repository root (assuming the checkout directory is named `aponiajs`):

```bash
bun install
bun packages/cli/bin/aponia.ts --help
bun packages/cli/bin/aponia.ts new my-api --dry-run
cd ..
bun ./aponiajs/packages/cli/bin/aponia.ts new my-api
cd my-api
bun ../aponiajs/packages/cli/bin/aponia.ts g res users --type rest
bun run dev
```

The dry run previews the files. The next command creates an application beside
the framework checkout. Its dependencies use the version in this checkout, so
that version must be available from the package registry for the default
installation to finish.

## Contributing

This repository contains the framework packages and CLI. Start with the
[repository guide](./AGENTS.md) and [release guide](./docs/releasing.md). Run
`bun run check`, `bun run test:coverage`, and `bun run test:vite-plus`
before submitting changes.

## Credits

The mascot illustration is third-party artwork, sourced from
<https://i.redd.it/at5g5eliklph1.png>.

## License

AponiaJS is available under the [MIT License](./LICENSE).
