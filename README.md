<div align="center">

<img
  src="./assets/aponia-debugging-chibi.webp"
  alt="Chibi Aponia calmly containing a tiny software bug beside a laptop"
  width="760"
/>

# AponiaJS

### ✨ Serene application architecture for Bun, powered by Elysia ✨

<p>
  <img alt="Bun" src="https://img.shields.io/badge/runtime-Bun-f9f1e1?style=flat-square&logo=bun&logoColor=14151a" />
  <img alt="Elysia" src="https://img.shields.io/badge/powered_by-Elysia-c7b8ff?style=flat-square" />
  <img alt="TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Experimental" src="https://img.shields.io/badge/status-experimental-ffb7d5?style=flat-square" />
</p>

**Structured like Nest · swift like Elysia · baked with Bun**

> 🌙 AponiaJS is experimental and not ready for production.

</div>

## Overview

AponiaJS is a Bun-first TypeScript framework that brings modules, controllers,
services, decorators, and dependency injection to an Elysia-native HTTP
runtime.

It is an architecture layer—not a NestJS port and not an Elysia replacement.
The goal is to keep larger Bun applications calm, explicit, and testable
without hiding the Elysia ecosystem.

|                         | What you get                                                    |
| ----------------------- | --------------------------------------------------------------- |
| 🪻 **Calm structure**   | Modules, controllers, and services with clear responsibilities. |
| 🧩 **Friendly DI**      | Constructor injection, tokens, and multiple provider styles.    |
| ⚡ **Elysia-native**    | Native routes, plugins, request handling, and lifecycle.        |
| 🍞 **Bun from day one** | Bun-native development, tests, builds, and workspace tooling.   |

## Packages

| Package                     | Purpose                                           |
| --------------------------- | ------------------------------------------------- |
| `@aponiajs/common`          | Decorators, contracts, providers, tokens, logging |
| `@aponiajs/core`            | Module graph and dependency injection runtime     |
| `@aponiajs/platform-elysia` | Elysia route mapping and application lifecycle    |
| `@aponiajs/cli`             | Bun-native application generator                  |
| `create-aponia`             | `bun create` command wrapper                      |
| `aponiajs`                  | Planned public convenience facade                 |

All packages currently use version `0.0.0` and are intended for workspace
development. They have not been published as a stable release.

## Quick Start

Requirements:

- Bun `1.3.14`
- Vite+ `0.2.x`
- TypeScript decorators and decorator metadata enabled

Install and run the example:

```bash
vp install
bun run example:basic
```

Call its route:

```bash
curl http://localhost:3000/greetings
```

Expected response:

```text
Hello, AponiaJS!
```

> 🦋 Your first route is awake.

## Application Fundamentals

```ts
import { Controller, Get, Injectable, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";

@Injectable()
class GreetingService {
  greet(): string {
    return "Hello, AponiaJS!";
  }
}

@Controller("greetings")
class GreetingController {
  constructor(private readonly greetingService: GreetingService) {}

  @Get()
  greet(): string {
    return this.greetingService.greet();
  }
}

@Module({
  controllers: [GreetingController],
  providers: [GreetingService],
})
class AppModule {}

const application = await AponiaFactory.create(AppModule);
await application.listen(3000);
```

Controllers own transport concerns, services own application behavior, and
modules define composition and provider visibility.

## Generate an Application

Generate a Nest-style starter from the workspace:

```bash
bun packages/cli/bin/aponia.ts new my-api --skip-install
```

Preview the generated files:

```bash
bun packages/cli/bin/aponia.ts n my-api --dry-run
```

The generated project currently references unpublished Aponia packages, so
`--skip-install` is required until the first public release.

## Development

| Command                 | Purpose                               |
| ----------------------- | ------------------------------------- |
| `vp install`            | Install workspace dependencies        |
| `bun run example:basic` | Start the example application         |
| `vp check`              | Format, lint, and type-check          |
| `bun test`              | Run the primary Bun test suite        |
| `vp test`               | Run the Vite+ compatibility test lane |
| `bun run build`         | Build every workspace package         |
| `vp env doctor`         | Diagnose toolchain issues             |

Before opening a pull request:

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
- [Package roadmap](./plans/npm-package-architecture-roadmap.md)
- [Contributor guidelines](./AGENTS.md)

## Contributing

Use short-lived feature branches and Conventional Commits. Keep repository
content in English, use Bun for runtime and package management, retain Vite+,
and add tests for behavioral changes.

Kind, focused contributions are welcome. 🌷

## Security

AponiaJS has not completed a production security review. The current foundation
does not provide authentication, authorization, input validation, rate
limiting, secret management, or secure production defaults.

## License and Acknowledgements

Package manifests declare the MIT license. A root license file will be included
before public distribution.

The project name pays tribute to Aponia, Disciplinary Perdition, from _Honkai
Impact 3rd_. The header is AI-generated fan-made artwork created for this
repository. Aponia and _Honkai Impact 3rd_ belong to their respective rights
holders.

AponiaJS is independently developed and is not endorsed by or affiliated with
HoYoverse, miHoYo, NestJS, Elysia, or their maintainers.
