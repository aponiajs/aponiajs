# AponiaJS

A progressive TypeScript framework for building efficient, reliable, and scalable server-side applications.

[![CI](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml/badge.svg)](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml)
[![CLI npm version](https://img.shields.io/npm/v/%40aponiajs%2Fcli/alpha?label=CLI)](https://www.npmjs.com/package/@aponiajs/cli)
[![Bun](https://img.shields.io/badge/Bun-1.4.5-black)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

## Description

AponiaJS runs on [Bun](https://bun.sh). [Elysia](https://elysiajs.com) is the default HTTP platform; Hono, H3, and Nitro are supported beside it. The framework provides modules, dependency injection, declarative routing, validation, and focused packages for authentication, persistence, messaging, and observability.

Requires Bun 1.4.5 or later. Decorator-based applications need `experimentalDecorators` and `emitDecoratorMetadata`; the CLI starter configures both.

## Installation

```bash
bun add --global @aponiajs/cli@alpha
aponia new my-api
cd my-api
bun run dev
```

The application listens on `http://localhost:3000`.

For an existing Bun project:

```bash
bun add @aponiajs/common@alpha @aponiajs/platform-elysia@alpha elysia@2.0.0-rc.4
```

## Quick start

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

`AponiaFactory` from `@aponiajs/platform-elysia` boots the default platform. Another runtime takes its adapter as the second argument: `AponiaFactory.create(AppModule, honoAdapter())` with `AponiaFactory` from `@aponiajs/platform-core`.

## Documentation

- [Documentation index](./docs/README.md)
- [Learning path](./docs/learn/README.md)
- [Dependency injection](./docs/build/dependency-injection.md)
- [CLI reference](./docs/tooling/cli.md)
- [Package catalog](./docs/reference/packages.md)
- [Migrating from NestJS](./docs/build/migrating-from-nest.md)

## Packages

The framework ships as focused packages with explicit dependencies:

- **Runtime**: `@aponiajs/common`, `@aponiajs/core`, `@aponiajs/compiler`, `@aponiajs/platform-core`, `@aponiajs/platform-elysia`, `@aponiajs/platform-hono`, `@aponiajs/platform-h3`.
- **Tooling**: `@aponiajs/cli`, `create-aponia`, `@aponiajs/testing`, `@aponiajs/devtools`.
- **Integrations**: `@aponiajs/graphql`, `@aponiajs/openapi`, `@aponiajs/mcp`, `@aponiajs/cors`, `@aponiajs/cron`, `@aponiajs/opentelemetry`.
- **Services**: `@aponiajs/auth`, `@aponiajs/audit`, `@aponiajs/cache`, `@aponiajs/compression`, `@aponiajs/database`, `@aponiajs/events`, `@aponiajs/http`, `@aponiajs/idempotency`, `@aponiajs/metrics`, `@aponiajs/queue`, `@aponiajs/rate-limit`, `@aponiajs/security`, `@aponiajs/session`, `@aponiajs/tenancy`.
- **Delivery**: `@aponiajs/microservices`, `@aponiajs/serverless`, `@aponiajs/h3`, `@aponiajs/hono`, `@aponiajs/nitro`.

All packages share one synchronized release version. See the [package catalog](./docs/reference/packages.md) for what is installable today.

## Release status

npm currently serves the `0.6.0-alpha.N` line for `@aponiajs/common`, `@aponiajs/core`, `@aponiajs/platform-elysia`, `@aponiajs/cli`, `create-aponia`, and `@aponiajs/devtools`. The source targets `1.0.0-beta.N`, which is not published yet.

The framework is pre-1.0 and not production ready. Pin an exact version and review the [stability policy](./docs/reference/stability.md) before deploying.

## Support

- Use [GitHub Issues](https://github.com/aponiajs/aponiajs/issues) for defects and feature requests.
- Report security vulnerabilities according to [SECURITY.md](./SECURITY.md).
- Read [RULES.md](./RULES.md) and [AGENTS.md](./AGENTS.md) before changing the framework itself.

## Contributing

```bash
bun install
bun run check
bun run test:coverage
bun run test:vite-plus
```

See the [release guide](./docs/operations/releasing.md) for versioning and publication.

## License

AponiaJS is [MIT licensed](./LICENSE).
