<div align="center">

<img
  src="./assets/aponia-character.jpg"
  alt="Aponia from Honkai Impact 3rd with in-game combat footage"
  width="100%"
/>

# AponiaJS

Structured applications for Bun

[Documentation](./docs/architecture-and-style.md) ·
[CLI](./docs/cli.md) ·
[Packages](./docs/packages.md) ·
[Roadmap](./plans/npm-package-architecture-roadmap.md)

[![CI](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml/badge.svg)](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcommon?label=npm&color=baa9d1)](https://www.npmjs.com/package/@aponiajs/common)
[![Bun](https://img.shields.io/badge/Bun-1.3.14-f8eddd?logo=bun&logoColor=24232d)](https://bun.sh)
[![Elysia](https://img.shields.io/badge/Elysia-1.4-d9ccea)](https://elysiajs.com)
[![License](https://img.shields.io/badge/License-MIT-e8b9b5)](./LICENSE)

Nest-inspired TypeScript architecture with dependency injection, decorated
controllers, and direct access to Elysia. Supercharged by Bun.

<sub>Experimental software · Not recommended for production yet</sub>

</div>

## Start

Create a Bun application:

```bash
bun add --global @aponiajs/cli
aponia new my-api
cd my-api
bun run dev
```

Or add AponiaJS to an existing project:

```bash
bun add @aponiajs/common @aponiajs/platform-elysia elysia
```

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
  getGreeting(): string {
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

## Why AponiaJS?

- **Familiar structure** — modules, controllers, services, and explicit
  dependency boundaries inspired by NestJS.
- **Bun from end to end** — runtime, package manager, test runner, and every
  public command use Bun.
- **Elysia without a wall** — decorated routes map to Elysia while native
  schemas, hooks, state, and plugins remain available.
- **Actionable diagnostics** — module cycles, missing exports, duplicate
  providers, and ambiguous dependencies fail clearly.

## Performance study

Aponia is evaluated with
[`SaltyAom/bun-http-framework-benchmark`](https://github.com/SaltyAom/bun-http-framework-benchmark)
as the primary HTTP benchmark. The study retains the upstream runner,
Bombardier configuration, correctness checks, and three workloads: a static
response, path-and-query extraction, and JSON parsing.

The CI publication contains no generated charts or images. Inspect the
[raw comparison table](https://raw.githubusercontent.com/aponiajs/aponiajs/benchmark-results/bun-http-framework-benchmark/results/results.md?v=0.3.21),
the [raw Aponia runner output](https://raw.githubusercontent.com/aponiajs/aponiajs/benchmark-results/bun-http-framework-benchmark/results/bun/aponia.txt?v=0.3.21),
and the [experimental environment](https://raw.githubusercontent.com/aponiajs/aponiajs/benchmark-results/bun-http-framework-benchmark/environment.json?v=0.3.21).
Absolute throughput is machine-specific; interpret comparisons only when both
treatments were measured in the same run.

The [research protocol](./benchmarks/README.md) documents the question,
experimental design, reproduction procedure, raw variables, and limitations.

## Generate

Install the published CLI and generate components with Nest-style commands:

```bash
bun add --global @aponiajs/cli

aponia new my-api
aponia generate module users
aponia generate controller users
aponia generate service users
aponia generate resource users --type rest
```

Short aliases work too:

```bash
aponia g mo users
aponia g co users
aponia g s users
aponia g res users
```

The catalog includes application, library, class, controller, decorator,
filter, gateway, guard, interface, interceptor, middleware, module, pipe,
provider, resolver, resource, and service generators. `router`, `routers`, and
`route` are controller aliases. See the [complete CLI reference](./docs/cli.md)
for options, module registration, transports, and dry runs.

## Packages

| Package                                                                                | Version                                                                                                                       | Purpose                                    |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [`@aponiajs/common`](https://www.npmjs.com/package/@aponiajs/common)                   | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcommon)](https://www.npmjs.com/package/@aponiajs/common)                   | Decorators, contracts, tokens, and logging |
| [`@aponiajs/core`](https://www.npmjs.com/package/@aponiajs/core)                       | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcore)](https://www.npmjs.com/package/@aponiajs/core)                       | Module graph and dependency injection      |
| [`@aponiajs/platform-elysia`](https://www.npmjs.com/package/@aponiajs/platform-elysia) | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fplatform-elysia)](https://www.npmjs.com/package/@aponiajs/platform-elysia) | Elysia adapter and application lifecycle   |
| [`@aponiajs/cli`](https://www.npmjs.com/package/@aponiajs/cli)                         | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcli)](https://www.npmjs.com/package/@aponiajs/cli)                         | Project and component generators           |
| [`create-aponia`](https://www.npmjs.com/package/create-aponia)                         | [![npm](https://img.shields.io/npm/v/create-aponia)](https://www.npmjs.com/package/create-aponia)                             | `bun create` entrypoint                    |

All public packages use synchronized versions. The reserved `aponiajs` facade
is private and should not be installed.

## Current scope

AponiaJS currently supports decorated modules and HTTP controllers, singleton
dependency injection, class/value/factory/alias providers, explicit tokens,
module imports and exports, lifecycle management, structured logging, project
generators, and an Elysia-native controller escape hatch.

Request decorators, validation pipes, runtime guards and interceptors,
middleware, exception filters, provider scopes, testing modules, OpenAPI,
authentication, WebSockets, and microservice transports are not implemented
yet. Use the [machine-readable roadmap](./roadmap/roadmap.json) and its
[JSON Schema](./roadmap/roadmap.schema.json) for tracker integrations. Review
the [architecture roadmap](./plans/npm-package-architecture-roadmap.md) before
adopting the framework for long-lived workloads.

## Develop

The repository uses Bun 1.3.14, managed through mise:

```bash
mise install
bun install
bun run check
bun test
bun run test:vite-plus
bun run build
```

Every push must include a synchronized
[Semantic Version](https://semver.org) increase:

```bash
bun run version:patch
# or: bun run version:minor
# or: bun run version:major
```

Read the [release guide](./docs/releasing.md) for the enforced hook and CI
workflow. Repository conventions live in [AGENTS.md](./AGENTS.md).

## License

AponiaJS is available under the [MIT License](./LICENSE).

The header features Aponia from _Honkai Impact 3rd_. Game imagery belongs to its
respective copyright holders. AponiaJS is independently developed and is not
affiliated with HoYoverse, miHoYo, Bun, Elysia, or NestJS.
