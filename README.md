<div align="center">
  <h1>AponiaJS</h1>
  <p><strong>A progressive TypeScript framework for building efficient, reliable, and scalable server-side applications.</strong></p>
</div>

[![CI](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml/badge.svg)](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml)
[![CLI npm version](https://img.shields.io/npm/v/%40aponiajs%2Fcli/beta?label=CLI)](https://www.npmjs.com/package/@aponiajs/cli)
[![Bun](https://img.shields.io/badge/Bun-1.4.4-black)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

## Description

AponiaJS runs on [Bun](https://bun.sh) and [Elysia](https://elysiajs.com). It
provides a module system, dependency injection, declarative HTTP routing,
runtime validation, and a coherent set of production services for
authentication, security, persistence, messaging, observability, and delivery.

Requirements: Bun 1.4.4 or later, and Elysia `2.0.0-rc.4` for the HTTP
platform package. Decorator-based applications need `experimentalDecorators`
and `emitDecoratorMetadata`; the CLI starter configures both.

The framework is in beta. Pin an exact version and review the
[stability policy](./docs/stability.md) before deploying to production.

## Philosophy

Enterprise systems fail at their boundaries: ambiguous ownership, implicit
dependencies, duplicated validation, and frameworks that hide the platform.
AponiaJS makes those boundaries explicit.

Applications are organized into modules, controllers, and providers. Decorators
record intent; the platform lowers that intent into immutable descriptors and a
single runtime graph. The same graph can be produced at build time, which is
what allows the CLI, introspection, and coding agents to reason about an
application without guessing at its structure. Applications that prefer it can
declare descriptors directly and skip decorators entirely.

The framework adopts existing specifications instead of inventing private
contracts: Standard Schema for validation, RFC 9457 for HTTP errors, OpenAPI for
documents, OpenTelemetry for tracing, Prometheus for metrics, and the Model
Context Protocol for tool integration. Native Elysia remains available through a
supported escape hatch, so the underlying platform is never out of reach.

## Getting started

Install the CLI, create an application, and generate a REST resource:

```bash
bun add --global @aponiajs/cli@beta
aponia new my-api
cd my-api
aponia generate resource users --type rest
aponia build
bun run dev
```

The application listens on `http://localhost:3000`.

`aponia build` refreshes the route invokers and module descriptors the
application boots from. Run it after generating code, or the new routes will not
be mounted.

## A minimal application

```ts
import { Controller, Get, Injectable, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";

@Injectable()
class UsersService {
  findAll(): readonly string[] {
    return [];
  }
}

@Controller("users")
class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  findAll(): readonly string[] {
    return this.users.findAll();
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class AppModule {}

const application = await AponiaFactory.create(AppModule);
await application.listen(3000);
```

## Documentation

- [Documentation index](./docs/README.md): the task map, reading order, and
  contracts behind the published pages.
- [Working with AI agents](./docs/ai-agents.md): context order, change protocol,
  safety boundaries, and the evidence a change must carry.
- [Learning path](./docs/learn/README.md): the ordered introduction to the
  framework.
- [CLI reference](./docs/cli.md): every command, schematic, and generated file.
- [Dependency injection](./docs/dependency-injection.md) and
  [validation](./docs/learn/06-validation.md).
- [Package catalog](./docs/packages.md): all published packages, their purpose,
  and their runtime dependencies.
- [Deployment](./docs/deployment.md), [stability](./docs/stability.md),
  [queues](./docs/queues.md),
  [database](./docs/database.md), and [metrics](./docs/metrics.md).
- [Migrating from NestJS](./docs/migrating-from-nest.md).
- [Security policy](./SECURITY.md) and the
  [threat model](./docs/threat-model.md).

## Packages

The framework ships as focused packages with explicit dependencies:

- **Runtime**: `@aponiajs/common`, `@aponiajs/core`,
  `@aponiajs/platform-elysia`.
- **Tooling**: `@aponiajs/cli`, `create-aponia`, `@aponiajs/devtools`,
  `@aponiajs/testing`.
- **Platform integrations**: `@aponiajs/graphql`, `@aponiajs/openapi`,
  `@aponiajs/mcp`, `@aponiajs/cors`, `@aponiajs/cron`,
  `@aponiajs/opentelemetry`.
- **Application services**: `@aponiajs/auth`, `@aponiajs/audit`,
  `@aponiajs/cache`, `@aponiajs/compression`, `@aponiajs/database`,
  `@aponiajs/events`, `@aponiajs/http`, `@aponiajs/idempotency`,
  `@aponiajs/metrics`, `@aponiajs/queue`, `@aponiajs/rate-limit`,
  `@aponiajs/security`, `@aponiajs/session`, `@aponiajs/tenancy`.
- **Delivery**: `@aponiajs/microservices`, `@aponiajs/serverless`.
- **Runtime adapters**: `@aponiajs/h3`, `@aponiajs/hono`, `@aponiajs/nitro`.

All packages share one synchronized release version.

## Project status

AponiaJS is in beta. The public API may change before the first stable release.
The current release covers HTTP, WebSockets, message-pattern microservices,
serverless adapters, authentication, tenancy, queues, databases, and
observability.

Stores for sessions, rate limits, cache, refresh tokens, revocations, queue
backlogs, and idempotency are process-local by default; multi-instance
deployments supply shared implementations of the published store contracts. The
queue preserves a backlog through a durable store but is not a broker. The MCP
server supports the `2024-11-05` through `2025-11-25` handshake revisions and
`server/discover`; full `2026-07-28` compliance is not claimed.

## Support

- Use [GitHub Issues](https://github.com/aponiajs/aponiajs/issues) for defects
  and feature requests.
- Report security vulnerabilities privately according to
  [SECURITY.md](./SECURITY.md).
- Read [RULES.md](./RULES.md) and [AGENTS.md](./AGENTS.md) before changing the
  framework itself.

## Contributing

This repository contains the framework, not an application built with it.
Changes become published npm packages and are treated as public API work.

```bash
bun install
bun run check
bun run test:coverage
bun run test:vite-plus
```

The [release guide](./docs/releasing.md) documents versioning and publication.

## License

AponiaJS is [MIT licensed](./LICENSE).
