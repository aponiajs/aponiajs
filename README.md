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
[Roadmap](./ROADMAP.md)

[![CI](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml/badge.svg)](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcommon/alpha?label=npm&color=baa9d1)](https://www.npmjs.com/package/@aponiajs/common)
[![Bun](https://img.shields.io/badge/Bun-1.3.14-f8eddd?logo=bun&logoColor=24232d)](https://bun.sh)
[![Elysia](https://img.shields.io/badge/Elysia-1.4-d9ccea)](https://elysiajs.com)
[![License](https://img.shields.io/badge/License-MIT-e8b9b5)](./LICENSE)

Nest-inspired TypeScript architecture with dependency injection, decorated
controllers, and direct access to Elysia. Supercharged by Bun.

<sub>Experimental software · Not recommended for production yet</sub>

</div>

## Start

```bash
bun add --global @aponiajs/cli
aponia new my-api
cd my-api
bun run dev
```

Or add AponiaJS to an existing project:

```bash
bun add @aponiajs/common@alpha @aponiajs/platform-elysia@alpha elysia
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

## Validate

Declare a schema on the route and invalid requests never reach the handler. Any
[Standard Schema](https://standardschema.dev) validator works — Zod, ArkType,
Valibot — as do TypeBox and Elysia's `t`:

```ts
import { Body, Controller, Get, Param, Post } from "@aponiajs/common";
import { z } from "zod";

const CreateUser = z.object({
  name: z.string().min(2),
});
type CreateUser = z.infer<typeof CreateUser>;

@Controller("users")
class UserController {
  constructor(private readonly userService: UserService) {}

  @Post("/", { body: CreateUser })
  createUser(@Body() body: CreateUser) {
    return this.userService.createUser(body);
  }

  @Get(":id")
  findUser(@Param("id") id: string) {
    return this.userService.findUser(id);
  }
}
```

`@Body()`, `@Query()`, `@Param()`, `@Headers()`, and `@Cookie()` inject one piece
of the request, each accepting an optional property name. `@Ctx()` hands over
Elysia's own context — `status`, `set`, `cookie`, `store`, `redirect`, and plugin
decorators — typed by the declared schema.

## Why AponiaJS?

- **Familiar structure** — modules, controllers, services, and explicit
  dependency boundaries inspired by NestJS.
- **Bun from end to end** — runtime, package manager, test runner, and every
  public command use Bun.
- **Elysia without a wall** — decorated routes map to Elysia while native
  schemas, hooks, state, and plugins remain available.
- **Actionable diagnostics** — module cycles, missing exports, duplicate
  providers, and ambiguous dependencies fail clearly.

## Generate

```bash
aponia new my-api
aponia generate module users
aponia generate resource users --type rest

aponia g mo users
aponia g res users
```

Every Nest schematic is available, from `class` and `controller` to `resource`
and `gateway`. See the [CLI reference](./docs/cli.md) for the full catalog,
aliases, options, and module registration.

## Packages

| Package                                                                                | Purpose                                    |
| -------------------------------------------------------------------------------------- | ------------------------------------------ |
| [`@aponiajs/common`](https://www.npmjs.com/package/@aponiajs/common)                   | Decorators, contracts, tokens, and logging |
| [`@aponiajs/core`](https://www.npmjs.com/package/@aponiajs/core)                       | Module graph and dependency injection      |
| [`@aponiajs/platform-elysia`](https://www.npmjs.com/package/@aponiajs/platform-elysia) | Elysia adapter and application lifecycle   |
| [`@aponiajs/cli`](https://www.npmjs.com/package/@aponiajs/cli)                         | Project and component generators           |
| [`create-aponia`](https://www.npmjs.com/package/create-aponia)                         | `bun create` entrypoint                    |

All public packages share one version and are published to the `alpha` channel;
`latest` is reserved for the first stable release.

## Current scope

Implemented: decorated modules and HTTP controllers, Standard Schema route
validation, request parameter decorators, singleton dependency injection,
class/value/factory/alias providers, explicit tokens, module imports and
exports, lifecycle management, structured logging, project generators, and an
Elysia-native controller escape hatch.

Not implemented yet: guards, interceptors, middleware, exception filters,
Problem Details errors, provider scopes, testing modules, OpenAPI,
authentication, WebSockets, and microservice transports. The
[roadmap](./ROADMAP.md) tracks every milestone and the plans behind it.

## Develop

```bash
mise install
bun install
bun run check
bun test
bun run test:vite-plus
bun run build
```

Every push must raise the synchronized version with `bun run version:alpha`.
Read the [release guide](./docs/releasing.md) for channels and the publish flow;
repository conventions live in [AGENTS.md](./AGENTS.md).

## License

AponiaJS is available under the [MIT License](./LICENSE).

The header features Aponia from _Honkai Impact 3rd_. Game imagery belongs to its
respective copyright holders. AponiaJS is independently developed and is not
affiliated with HoYoverse, miHoYo, Bun, Elysia, or NestJS.
