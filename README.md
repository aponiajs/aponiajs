<div align="center">

<img
  src="./assets/aponia-header-minimal.webp"
  alt="AponiaJS"
  width="760"
/>

# AponiaJS

### Nest-inspired application architecture for Bun, powered by Elysia

Modules, controllers, services, and dependency injection on an Elysia-native
HTTP runtime.

**Experimental — not ready for production**

</div>

## Description

AponiaJS is a Bun-first TypeScript framework that combines Nest-style
application structure with the Elysia HTTP runtime.

Application code uses decorators such as `@Module()`, `@Controller()`, `@Get()`,
and `@Injectable()`. The core validates the module graph and resolves providers,
while the Elysia platform maps controller metadata to native routes.

AponiaJS is not a NestJS port and does not replace Elysia.

## Project Status

The current release is an experimental framework foundation.

### Implemented

- modules, controllers, services, and constructor injection;
- `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` route decorators;
- module imports, provider exports, and singleton resolution;
- class, value, factory, alias, and explicit-token providers;
- cycle, duplicate, missing-export, and ambiguous-provider diagnostics;
- Elysia request handling, listening, shutdown, and URL discovery;
- configurable text and JSON logging;
- Bun-native project generation;
- Bun and Vite+ test lanes.

### Not implemented

- request parameter decorators;
- pipes, guards, interceptors, middleware, and exception filters;
- request and transient provider scopes;
- testing modules and provider overrides;
- OpenAPI, WebSockets, microservices, and authentication;
- CLI resource generation;
- a composite Eden client type.

See the [package roadmap](./plans/npm-package-architecture-roadmap.md) for
planned work.

## Requirements

- Bun `1.3.14`
- Vite+ `0.2.x`
- TypeScript with `experimentalDecorators` and `emitDecoratorMetadata`

## Getting Started

Create a project:

```bash
bun create aponia my-api
```

Run the example from this repository:

```bash
vp install
bun run example:basic
```

Call the example route:

```bash
curl http://localhost:3000/greetings
```

Expected response:

```text
Hello, AponiaJS!
```

## Generate a Standard Application

The generator creates a flat starter layout:

```text
my-api/
|-- src/
|   |-- app.controller.spec.ts
|   |-- app.controller.ts
|   |-- app.module.ts
|   |-- app.service.ts
|   `-- main.ts
|-- test/
|   `-- app.e2e-spec.ts
|-- .env.example
|-- .gitignore
|-- aponia.json
|-- package.json
|-- README.md
|-- tsconfig.json
`-- vite.config.ts
```

Use the local CLI while developing the framework:

```bash
bun packages/cli/bin/aponia.ts new my-api --skip-install
bun packages/cli/bin/aponia.ts new my-api --dry-run
```

## Application Fundamentals

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

### Feature Module

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

### Root Module

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

## Existing Elysia Route Plugins

Use `defineElysiaController()` when a controller needs native Elysia schemas,
hooks, state, decorators, or plugins.

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

## Dependency Injection

Class providers are inferred from constructor metadata. Use explicit tokens for
interfaces, primitives, or configuration:

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

## Application and Logging API

```ts
application.getNativeApplication();
application.handle(request);
await application.listen(3000);
application.getUrl();
await application.close();
```

Configure log levels:

```ts
const application = await AponiaFactory.create(AppModule, {
  logger: ["error", "warn", "log"],
});
```

Use JSON output:

```ts
import { ConsoleLogger } from "@aponiajs/common";

const application = await AponiaFactory.create(AppModule, {
  logger: new ConsoleLogger({ json: true }),
});
```

See the [logging guide](./docs/logging.md) for the complete API.

## Workspace Packages

| Package                                                                                | Responsibility                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------ |
| [`@aponiajs/common`](https://www.npmjs.com/package/@aponiajs/common)                   | Decorators, contracts, tokens, and logging |
| [`@aponiajs/core`](https://www.npmjs.com/package/@aponiajs/core)                       | Module graph and dependency injection      |
| [`@aponiajs/platform-elysia`](https://www.npmjs.com/package/@aponiajs/platform-elysia) | Elysia integration and lifecycle           |
| [`@aponiajs/cli`](https://www.npmjs.com/package/@aponiajs/cli)                         | Project generator                          |
| [`create-aponia`](https://www.npmjs.com/package/create-aponia)                         | `bun create` entry point                   |
| `aponiajs`                                                                             | Planned public facade                      |

Dependency direction:

```text
@aponiajs/common
       |
       v
@aponiajs/core
       |
       v
@aponiajs/platform-elysia ---> elysia
```

## Repository Layout

```text
.
|-- packages/
|   |-- common/
|   |-- core/
|   |-- platform-elysia/
|   |-- cli/
|   |-- create-aponia/
|   `-- aponiajs/
|-- examples/
|-- docs/
|-- plans/
|-- package.json
`-- vite.config.ts
```

## Development

| Command                   | Purpose                              |
| ------------------------- | ------------------------------------ |
| `vp install`              | Install workspace dependencies       |
| `bun run example:basic`   | Run the example application          |
| `vp check`                | Format, lint, and type-check         |
| `bun test`                | Run the Bun test suite               |
| `vp test`                 | Run the Vite+ compatibility tests    |
| `bun run build`           | Build all workspace packages         |
| `bun run release:dry-run` | Inspect publishable package archives |

## Documentation

- [Architecture](./docs/architecture-and-style.md)
- [CLI](./docs/cli.md)
- [Logging](./docs/logging.md)
- [Releasing](./docs/releasing.md)
- [Package roadmap](./plans/npm-package-architecture-roadmap.md)
- [Repository guidelines](./AGENTS.md)

## Contributing

Use Bun for runtime and package management, retain Vite+, keep repository
content in English, and add tests for behavioral changes.

## Security

AponiaJS has not completed a production security review. The current foundation
does not provide authentication, authorization, input validation, rate
limiting, secret management, or secure production defaults.

## License

MIT

## Acknowledgements

The project name and header artwork reference Aponia from _Honkai Impact 3rd_.
AponiaJS is independently developed and is not affiliated with HoYoverse,
miHoYo, NestJS, or Elysia.
