<div align="center">

<img
  src="./assets/aponia-character.jpg"
  alt="Aponia, Disciplinary Perdition, from Honkai Impact 3rd"
  width="720"
/>

# AponiaJS

### ✨ Serene application architecture for Bun, powered by Elysia ✨

<p>
  <img alt="Bun" src="https://img.shields.io/badge/runtime-Bun-f9f1e1?style=flat-square&logo=bun&logoColor=14151a" />
  <img alt="Elysia" src="https://img.shields.io/badge/powered_by-Elysia-c7b8ff?style=flat-square" />
  <img alt="TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Experimental" src="https://img.shields.io/badge/status-experimental-ffb7d5?style=flat-square" />
</p>

Organize applications with modules, controllers, services, and dependency
injection while retaining an Elysia-native HTTP runtime.

**Structured like Nest · swift like Elysia · baked with Bun**

> 🌙 Experimental foundation — lovely to explore, not ready for production.

</div>

## Welcome, Traveler 🌸

AponiaJS is a Bun-first TypeScript framework foundation that combines two
complementary ideas:

- the explicit, testable application structure popularized by
  [NestJS](https://nestjs.com/); and
- the lightweight, plugin-oriented HTTP runtime and type inference provided by
  [Elysia](https://elysiajs.com/).

Application code uses familiar decorators such as `@Module()`,
`@Controller()`, `@Get()`, and `@Injectable()`. The Elysia platform compiles
that metadata into native routes, while the platform-neutral core validates the
module graph and resolves singleton providers.

Aponia is not a NestJS port and does not replace Elysia. It is an architecture
layer that aims to make larger Bun applications easier to organize without
reimplementing the Elysia ecosystem.

<div align="center">

<img
  src="./assets/aponia-debugging-chibi.webp"
  alt="Fan-made chibi Aponia calmly containing a tiny software bug beside a laptop"
  width="720"
/>

<sub><em>The bug has been gently contained. You may continue coding. 🦋</em></sub>

</div>

### Why AponiaJS?

|                         | What you get                                                    |
| ----------------------- | --------------------------------------------------------------- |
| 🪻 **Calm structure**   | Modules, controllers, and services with clear responsibilities. |
| 🧩 **Friendly DI**      | Familiar decorators and several provider styles.                |
| ⚡ **Elysia speed**     | Native Elysia routes without hiding the underlying runtime.     |
| 🍞 **Bun from day one** | Bun-native development, tests, builds, and workspace tooling.   |

**Choose your path:** [Get started](#getting-started-from-the-repository) ·
[Learn the fundamentals](#application-fundamentals) ·
[Meet the packages](#workspace-packages) · [Contribute](#contributing)

## Project Status 🔮

The repository currently contains a working foundation, not a complete
framework release. Packages use version `0.0.0` and are intended for workspace
development.

### Ready to explore

- decorated modules, controllers, services, and constructor injection;
- `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` route decorators;
- module imports, provider exports, and singleton dependency resolution;
- class, value, factory, alias, and explicit-token providers;
- cycle, duplicate, missing-export, and ambiguous-provider diagnostics;
- Elysia application creation, in-memory request handling, listening, shutdown,
  and server URL discovery;
- Nest-style startup logging, log-level filtering, JSON output, and custom
  logger support;
- a Bun-native `new`/`n` project generator with dry-run and skip-install
  options;
- Bun tests, a Vite+ conformance lane, and independently built workspace
  packages.

### Still in the prophecy

- request parameter decorators such as body, query, parameter, header, and
  request injection;
- pipes, guards, interceptors, middleware, and exception filters;
- request or transient provider scopes and async lifecycle hooks;
- a testing-module builder and provider overrides;
- OpenAPI, WebSockets, microservices, configuration, scheduling, caching,
  authentication, and rate limiting;
- CLI component or resource generation;
- a public end-to-end typed client contract equivalent to Elysia Eden;
- complete bidirectional support for every Elysia `.use()` plugin form.

See the [package architecture roadmap](./plans/npm-package-architecture-roadmap.md)
for planned boundaries. Roadmap entries are design targets, not shipped APIs.

## Requirements

- [Bun](https://bun.sh/) `1.3.14`
- TypeScript with `experimentalDecorators` and `emitDecoratorMetadata`
- Vite+ `0.2.x` for formatting, linting, type checking, tests, and packaging

This repository uses Bun for runtime execution, dependency installation, and
workspace orchestration. Do not replace Bun with npm, pnpm, or Yarn. Vite+ is
intentionally retained.

## Getting Started from the Repository 🚀

Install workspace dependencies:

```bash
vp install
```

Run the executable example:

```bash
bun run example:basic
```

The startup sequence reports module initialization, mapped routes, and the
address returned by the Elysia/Bun server:

```text
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [AponiaFactory] Starting Aponia application...
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [InstanceLoader] GreetingModule dependencies initialized +2ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [RouterExplorer] Mapped {/greetings, GET} route +1ms
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [AponiaApplication] Application is running on: http://localhost:3000 +0ms
```

Call the example route:

```bash
curl http://localhost:3000/greetings
```

Expected response:

```text
Hello, AponiaJS!
```

> 🦋 Your first route is awake.

## Generate a Standard Application 🪄

The local CLI follows the standard-mode layout produced by `nest new`:

```bash
bun packages/cli/bin/aponia.ts new my-api --skip-install
```

Preview generated files without writing:

```bash
bun packages/cli/bin/aponia.ts n my-api --dry-run
```

Generated layout:

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

The generated package currently references unpublished Aponia packages.
`--skip-install` is therefore required for local scaffolding until the first
public package release. The intended published entry point is:

```bash
bun create aponia my-api
```

## Application Fundamentals

### Service

Services own application and domain behavior.

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

Controllers own transport routes and delegate work to injected services.

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

### Feature module

Modules define provider visibility and controller ownership.

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

### Root module

The root module composes feature modules.

```ts
import { Module } from "@aponiajs/common";
import { GreetingModule } from "./greeting/greeting.module.ts";

@Module({
  imports: [GreetingModule],
})
export class AppModule {}
```

### Bootstrap

`main.ts` creates the application through the Elysia platform and starts the
listener. Business logic does not belong in bootstrap code.

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule);
  await application.listen(Number(Bun.env.PORT ?? 3000));
}

await bootstrap();
```

The normal request flow is:

```text
main.ts
  -> AponiaFactory
  -> AppModule
  -> feature module
  -> controller
  -> service
  -> Elysia response
```

## Existing Elysia Route Plugins

The low-level controller adapter allows a module to build routes with the
native Elysia API. This is the current escape hatch for Elysia schemas, hooks,
state, decorators, and ecosystem plugins used inside that route plugin.

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

The returned plugin retains its Elysia type inside the descriptor. The current
application factory does not yet expose a composite Eden client type for all
decorated controllers.

## Dependency Injection

Class providers are inferred from emitted constructor metadata:

```ts
@Injectable()
class ReportsService {
  constructor(private readonly repository: ReportsRepository) {}
}
```

Use an explicit token for interfaces, primitives, or configuration values:

```ts
import { Inject, Injectable, createToken } from "@aponiajs/common";

export const API_PREFIX = createToken<string>("api-prefix");

@Injectable()
class UrlService {
  constructor(@Inject(API_PREFIX) private readonly prefix: string) {}
}
```

The low-level provider API also supports `provideValue`, `provideFactory`,
`provideClass`, and `provideAlias`. Providers are singleton-scoped in the
current runtime.

## Application and Logging API

The Elysia application wrapper currently exposes:

```ts
application.getNativeApplication();
application.handle(request);
await application.listen(3000);
application.getUrl();
await application.close();
```

Disable system logs or limit their levels:

```ts
const application = await AponiaFactory.create(AppModule, {
  logger: ["error", "warn", "log"],
});
```

Use structured JSON output:

```ts
import { ConsoleLogger } from "@aponiajs/common";

const application = await AponiaFactory.create(AppModule, {
  logger: new ConsoleLogger({ json: true }),
});
```

See the complete [logging guide](./docs/logging.md) for contexts, elapsed
timestamps, custom loggers, and `getUrl()` behavior.

## Workspace Packages

| Package                     | Responsibility                                                    | Status                 |
| --------------------------- | ----------------------------------------------------------------- | ---------------------- |
| `@aponiajs/common`          | Decorators, tokens, providers, errors, and logging contracts      | Implemented foundation |
| `@aponiajs/core`            | Module graph validation and singleton dependency injection        | Implemented foundation |
| `@aponiajs/platform-elysia` | Decorated-controller compilation and Elysia application lifecycle | Implemented foundation |
| `@aponiajs/cli`             | Standard application generator and CLI argument handling          | `new` only             |
| `create-aponia`             | `bun create` executable wrapper                                   | Workspace only         |
| `aponiajs`                  | Planned convenience facade                                        | Placeholder            |

Dependency direction:

```text
@aponiajs/common
       |
       v
@aponiajs/core
       |
       v
@aponiajs/platform-elysia ---> elysia

@aponiajs/cli ---> generated application templates
create-aponia ---> @aponiajs/cli
```

`@aponiajs/common` does not depend on Elysia. Transport behavior remains in the
platform package.

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
|   `-- basic-foundation/
|-- docs/
|-- plans/
|-- AGENTS.md
|-- package.json
`-- vite.config.ts
```

Framework packages live under `packages/` because they are designed for
independent npm publication. Generated applications use Nest-style standard
mode and place later features directly under `src/<feature>/`.

## Development

Run commands from the workspace root:

| Command                                            | Purpose                                              |
| -------------------------------------------------- | ---------------------------------------------------- |
| `vp install`                                       | Install and synchronize Bun workspace dependencies   |
| `bun run example:basic`                            | Start the executable HTTP example                    |
| `bun test`                                         | Run the primary Bun unit and integration tests       |
| `bun run --cwd examples/basic-foundation test:e2e` | Run the example E2E test                             |
| `vp test`                                          | Run the Vite+ conformance tests                      |
| `vp check`                                         | Format, lint, and type-check all configured packages |
| `bun run build`                                    | Build every workspace package and example            |
| `vp env doctor`                                    | Diagnose Vite+ or package-manager configuration      |

Before submitting changes, run:

```bash
vp check
bun test
vp test
bun run build
```

## Documentation

- [Architecture and application structure](./docs/architecture-and-style.md)
- [CLI commands and generated layout](./docs/cli.md)
- [Logging](./docs/logging.md)
- [NPM package architecture roadmap](./plans/npm-package-architecture-roadmap.md)
- [Contributor and agent guidelines](./AGENTS.md)

Reference projects:

- [NestJS repository](https://github.com/nestjs/nest)
- [NestJS first steps](https://docs.nestjs.com/first-steps)
- [NestJS modules](https://docs.nestjs.com/modules)
- [Elysia repository](https://github.com/elysiajs/elysia)
- [Elysia quick start](https://elysiajs.com/quick-start)
- [Elysia plugins](https://elysiajs.com/essential/plugin)

## Contributing

Read [AGENTS.md](./AGENTS.md) before editing. Keep repository files in English,
use Bun for package management, retain Vite+, and add tests for behavioral
changes. Pull requests should identify affected packages and include validation
results.

Kind, focused contributions are always welcome. Small pull requests are easier
to review, and a clear test is one of the nicest gifts you can bring. 🌷

## Security

This project is experimental and has not completed a production security
review. Do not treat the current foundation as providing authentication,
authorization, input validation, rate limiting, secret management, or secure
production defaults. Report security-sensitive findings privately to the
maintainers once a security contact is published; do not include secrets or
exploit data in public fixtures.

## License

Package manifests currently declare the MIT license. A root license file must
be added before public distribution.

## Acknowledgements

AponiaJS is independently developed and is not affiliated with NestJS, Elysia,
or their maintainers. NestJS informs the application architecture and
documentation vocabulary; Elysia provides the HTTP runtime and native plugin
model; Bun provides the runtime and workspace toolchain.

The project name and original header artwork pay tribute to Aponia, Disciplinary
Perdition, from _Honkai Impact 3rd_. The original header artwork comes from the
[official Honkai Impact 3rd character introduction](https://www.hoyolab.com/article/4612171)
on HoYoLAB. The debugging illustration is AI-generated fan-made artwork created
for this repository. Aponia, _Honkai Impact 3rd_, and the official artwork
belong to their respective rights holders. AponiaJS is an independent
open-source project and is not endorsed by or affiliated with HoYoverse or
miHoYo.
