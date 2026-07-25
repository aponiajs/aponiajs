<div align="center">

<img
  src="./assets/aponia-character.jpg"
  alt="Aponia from Honkai Impact 3rd with in-game combat footage"
  width="820"
/>

# AponiaJS

### Structured like Nest. Light like Elysia. Made for Bun.

A tiny, Nest-inspired TypeScript framework with modules, controllers, services,
and dependency injection on an Elysia-native HTTP runtime.

[![CI](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml/badge.svg)](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml)
[![Bun](https://img.shields.io/badge/Bun-1.3.14-fbf0df?logo=bun&logoColor=14151a)](https://bun.sh)
[![Elysia](https://img.shields.io/badge/Elysia-1.4-ccb9f6)](https://elysiajs.com)
[![License](https://img.shields.io/badge/License-MIT-e9d5ff)](./LICENSE)

[Quick start](#quick-start) · [Fundamentals](#fundamentals) ·
[Packages](./docs/packages.md) · [Roadmap](./plans/npm-package-architecture-roadmap.md)

<sub>Experimental foundation · not ready for production</sub>

</div>

## A gentle kind of structure

[NestJS](https://nestjs.com) makes large applications easier to reason about.
[Elysia](https://elysiajs.com) makes Bun servers fast, expressive, and
type-friendly. AponiaJS brings those ideas together without trying to replace
either project.

```text
familiar application architecture  +  a small Bun-native runtime
```

- **Familiar** — `@Module()`, `@Controller()`, `@Get()`, and `@Injectable()`.
- **Focused** — the core handles the module graph and dependency injection.
- **Native** — the platform maps controller metadata directly to Elysia routes.
- **Composable** — native Elysia plugins remain available when you need them.

## Quick start

You need [Bun 1.3.14](https://bun.sh) and
[Vite+ 0.2.x](https://viteplus.dev).

```bash
bun create aponia my-api
cd my-api
bun run dev
```

Or explore the example in this repository:

```bash
vp install
bun run example:basic
```

```bash
curl http://localhost:3000/greetings
```

```text
Hello, AponiaJS!
```

## Fundamentals

The application model is intentionally small: a service owns behavior, a
controller maps routes, a feature module groups them, and a root module starts
the application.

### Service

```ts
import { Injectable } from "@aponiajs/common";

@Injectable()
export class GreetingService {
  createGreeting(): string {
    return "Hello, AponiaJS!";
  }
}
```

### Controller

```ts
import { Controller, Get } from "@aponiajs/common";
import { GreetingService } from "./greeting.service.ts";

@Controller("greetings")
export class GreetingController {
  constructor(private readonly greetingService: GreetingService) {}

  @Get()
  getGreeting(): string {
    return this.greetingService.createGreeting();
  }
}
```

### Module

```ts
import { Module } from "@aponiajs/common";
import { GreetingController } from "./greeting.controller.ts";
import { GreetingService } from "./greeting.service.ts";

@Module({
  controllers: [GreetingController],
  providers: [GreetingService],
  exports: [GreetingService],
})
export class GreetingModule {}
```

```ts
import { Module } from "@aponiajs/common";
import { GreetingModule } from "./greeting/greeting.module.ts";

@Module({
  imports: [GreetingModule],
})
export class AppModule {}
```

### Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Keep the Elysia escape hatch

Use `defineElysiaController()` when a route needs native Elysia schemas, hooks,
state, decorators, or plugins.

```ts
import { defineModule } from "@aponiajs/common";
import { defineElysiaController } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";

class HealthController {
  getStatus(): { status: "ok" } {
    return { status: "ok" };
  }
}

const HealthRoutes = defineElysiaController(HealthController, {
  inject: [] as const,
  buildPlugin: (controller) =>
    new Elysia({ name: "health" }).get("/health", () => controller.getStatus()),
});

export const HealthModule = defineModule({
  id: "health",
  controllers: [HealthRoutes],
});
```

## Dependency injection

Class providers are inferred from constructor metadata. Use explicit tokens for
interfaces, primitives, and configuration.

```ts
import { Inject, Injectable, createToken } from "@aponiajs/common";

export const API_PREFIX = createToken<string>("api-prefix");

@Injectable()
class UrlService {
  constructor(@Inject(API_PREFIX) private readonly prefix: string) {}
}
```

The provider API also supports `provideValue`, `provideFactory`, `provideClass`,
and `provideAlias`.

## Application API

```ts
application.getNativeApplication();
application.handle(request);
await application.listen(3000);
application.getUrl();
await application.close();
```

Logging can use selected levels or structured JSON output:

```ts
import { ConsoleLogger } from "@aponiajs/common";

const application = await AponiaFactory.create(AppModule, {
  logger: new ConsoleLogger({ json: true }),
});
```

See the [logging guide](./docs/logging.md) for the complete API.

## Workspace packages

| Package                                                                                | npm                                                                                                                                        | A small job, done well                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| [`@aponiajs/common`](https://www.npmjs.com/package/@aponiajs/common)                   | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcommon?label=latest)](https://www.npmjs.com/package/@aponiajs/common)                   | Decorators, contracts, tokens, and logging |
| [`@aponiajs/core`](https://www.npmjs.com/package/@aponiajs/core)                       | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcore?label=latest)](https://www.npmjs.com/package/@aponiajs/core)                       | Module graph and dependency injection      |
| [`@aponiajs/platform-elysia`](https://www.npmjs.com/package/@aponiajs/platform-elysia) | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fplatform-elysia?label=latest)](https://www.npmjs.com/package/@aponiajs/platform-elysia) | Elysia integration and lifecycle           |
| [`@aponiajs/cli`](https://www.npmjs.com/package/@aponiajs/cli)                         | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcli?label=latest)](https://www.npmjs.com/package/@aponiajs/cli)                         | Project generator                          |
| [`create-aponia`](https://www.npmjs.com/package/create-aponia)                         | [![npm](https://img.shields.io/npm/v/create-aponia?label=latest)](https://www.npmjs.com/package/create-aponia)                             | `bun create` entry point                   |
| `aponiajs`                                                                             | Not published                                                                                                                              | Planned public facade                      |

```text
@aponiajs/common
       │
       ▼
@aponiajs/core
       │
       ▼
@aponiajs/platform-elysia ───▶ elysia
```

<details>
<summary><strong>Generated application layout</strong></summary>

```text
my-api/
├── src/
│   ├── app.controller.spec.ts
│   ├── app.controller.ts
│   ├── app.module.ts
│   ├── app.service.ts
│   └── main.ts
├── test/
│   └── app.e2e-spec.ts
├── .env.example
├── .gitignore
├── aponia.json
├── package.json
├── README.md
├── tsconfig.json
└── vite.config.ts
```

Use the local CLI while developing the framework:

```bash
bun packages/cli/bin/aponia.ts new my-api --skip-install
bun packages/cli/bin/aponia.ts new my-api --dry-run
bun packages/cli/bin/aponia.ts g controller users
bun packages/cli/bin/aponia.ts g service users
bun packages/cli/bin/aponia.ts g resource users --type rest
```

</details>

<details>
<summary><strong>Project status</strong></summary>

### Available today

- modules, controllers, services, and constructor injection;
- `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` route decorators;
- module imports, provider exports, and singleton resolution;
- class, value, factory, alias, and explicit-token providers;
- cycle, duplicate, missing-export, and ambiguous-provider diagnostics;
- Elysia request handling, listening, shutdown, and URL discovery;
- configurable text and JSON logging;
- Bun-native project, component, and resource generation;
- Bun and Vite+ test lanes.

### Still ahead

- request parameter decorators;
- pipes, guards, interceptors, middleware, and exception filters;
- request and transient provider scopes;
- testing modules and provider overrides;
- OpenAPI, WebSockets, microservices, and authentication;
- a composite Eden client type.

</details>

## Development

| Command                   | Purpose                              |
| ------------------------- | ------------------------------------ |
| `bun install`             | Install workspace dependencies       |
| `bun run example:basic`   | Run the example application          |
| `bun run check`           | Format, lint, and type-check         |
| `bun test`                | Run the Bun test suite               |
| `bun run test:vite-plus`  | Run the Vite+ compatibility tests    |
| `bun run build`           | Build all workspace packages         |
| `bun run release:dry-run` | Inspect publishable package archives |

Repository map:

```text
.
├── packages/    framework, platform, and tooling packages
├── examples/    executable applications
├── docs/        architecture and contributor guides
└── plans/       package and framework roadmaps
```

Read more in the [architecture guide](./docs/architecture-and-style.md),
[package catalog](./docs/packages.md), [CLI guide](./docs/cli.md), and
[release guide](./docs/releasing.md).

## Versioning

AponiaJS follows [Semantic Versioning](https://semver.org) and releases all
workspace packages together. During `0.x`, the public API is experimental.

Conventional Commits determine the next version:

- `fix:` → patch;
- `feat:` → minor;
- `feat!:` or `BREAKING CHANGE:` → major.

Use the bundled `bumpp` commands before every push:

```bash
bun run version:patch # or version:minor / version:major
```

The command synchronizes every workspace package and refreshes the Bun
lockfile. CI rejects a push when its version does not increase. A push to
`main` creates the matching GitHub release and starts npm publishing.

## Contributing

Use Bun for runtime and package management, retain Vite+, keep repository
content in English, and add tests for behavioral changes.

## Security

AponiaJS has not completed a production security review. The current foundation
does not provide authentication, authorization, input validation, rate
limiting, secret management, or secure production defaults.

## License

[MIT](./LICENSE)

## Acknowledgements

The project name and header use Aponia character artwork and gameplay imagery
from _Honkai Impact 3rd_. All game imagery belongs to its respective copyright
holders.

AponiaJS is independently developed and is not affiliated with HoYoverse,
miHoYo, NestJS, or Elysia.
