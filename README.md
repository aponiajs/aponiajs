<div align="center">

<img
  src="./assets/aponia-character.jpg"
  alt="Aponia from Honkai Impact 3rd with in-game combat footage"
  width="100%"
/>

# AponiaJS

Structured applications for Bun

[Documentation](./docs/architecture-and-style.md) ·
[Dependency injection](./docs/dependency-injection.md) ·
[Testing](./docs/testing.md) ·
[CLI](./docs/cli.md) ·
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

## Services

A service holds business behavior. `@Injectable()` marks it for constructor
injection:

```ts
import { Injectable } from "@aponiajs/common";

@Injectable()
export class UserService {
  private readonly users = new Map<string, { id: string; name: string }>();

  create(name: string) {
    const user = { id: crypto.randomUUID(), name };
    this.users.set(user.id, user);
    return user;
  }

  findOne(id: string) {
    return this.users.get(id);
  }
}
```

## Controllers

A controller owns routes and delegates to services. Dependencies arrive through
the constructor:

```ts
import { Controller, Get, Param } from "@aponiajs/common";
import { UserService } from "./user.service.ts";

@Controller("users")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get(":id")
  findUser(@Param("id") id: string) {
    return this.userService.findOne(id);
  }
}
```

`@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Head`, and `@Options` map to the
matching HTTP method. Paths join with the controller prefix, so this route
answers `GET /users/:id`.

## Modules

A module wires controllers and providers together and declares what it shares.
Only exported providers are visible to modules that import it:

```ts
import { Module } from "@aponiajs/common";
import { UserController } from "./user.controller.ts";
import { UserService } from "./user.service.ts";

@Module({
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
```

`UserService` is visible to any module that imports `UserModule`; a provider
left out of `exports` stays private to its own module.

## Providers

A class provider is the common case, and the descriptor helpers cover values,
factories, and aliases. Anything that is not a class needs an explicit token:

```ts
import {
  Inject,
  Injectable,
  Module,
  createToken,
  provideFactory,
  provideValue,
} from "@aponiajs/common";

export const APP_NAME = createToken<string>("APP_NAME");
export const GREETING = createToken<string>("GREETING");

@Module({
  providers: [
    provideValue(APP_NAME, "my-api"),
    provideFactory(GREETING, [APP_NAME], (name) => `Hello from ${name}`),
  ],
  exports: [GREETING],
})
export class ConfigModule {}

@Injectable()
export class GreetingService {
  constructor(@Inject(GREETING) private readonly greeting: string) {}
}
```

`provideClass` and `provideAlias` complete the set. Providers are singletons.
The [dependency injection guide](./docs/dependency-injection.md) covers tokens,
visibility, and the error codes raised when a graph is wrong.

## Bootstrap

The root module composes the feature modules, and `main.ts` owns the process.
The factory compiles the module graph, validates it, builds the container, and
mounts every controller as an Elysia plugin:

```ts
// src/app.module.ts
import { Module } from "@aponiajs/common";
import { UserModule } from "./user/user.module.ts";

@Module({ imports: [UserModule] })
export class AppModule {}
```

```ts
// src/main.ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule);
  const port = Number(Bun.env.PORT ?? 3000);
  await application.listen(port);
}

await bootstrap();
```

Module cycles, missing exports, duplicate providers, and ambiguous dependencies
fail here, before the server listens. Application logging is configurable —
`{ logger: false }` silences it, an array of levels filters it, and a
`LoggerService` replaces it. See the [logging guide](./docs/logging.md).

## Request parameters

Parameter decorators inject one piece of the request. Each accepts an optional
name that selects a single property:

| Decorator             | Injects                        |
| --------------------- | ------------------------------ |
| `@Body()`             | The validated request body     |
| `@Query("term")`      | The parsed query string        |
| `@Param("id")`        | Path parameters                |
| `@Headers("x-agent")` | Request headers                |
| `@Cookie("session")`  | Cookies, or one cookie's value |
| `@Req()`              | The native `Request`           |
| `@Res()`              | The mutable response settings  |
| `@Ctx()`              | The whole Elysia context       |

```ts
import { Body, Controller, Get, Headers, Param, Post, Query } from "@aponiajs/common";

@Controller("users")
export class UserController {
  @Post()
  create(@Body() body: { name: string }, @Headers("x-tenant") tenant: string) {
    return { tenant, name: body.name };
  }

  @Get(":id")
  findOne(@Param("id") id: string, @Query("expand") expand: string | undefined) {
    return { id, expand };
  }
}
```

Types come from the annotation you write, exactly as in NestJS.

## Validate

Declare a schema on the route and invalid requests never reach the handler. Any
[Standard Schema](https://standardschema.dev) validator works — Zod, ArkType,
Valibot — as do TypeBox and Elysia's `t`:

```ts
import { Body, Controller, Post } from "@aponiajs/common";
import { z } from "zod";

const CreateUser = z.object({
  name: z.string().min(2),
});
type CreateUser = z.infer<typeof CreateUser>;

@Controller("users")
export class UserController {
  @Post("/", { body: CreateUser })
  create(@Body() body: CreateUser) {
    return body;
  }
}
```

`body`, `query`, `params`, `headers`, and `response` are the available slots. A
rejected request returns `422` without running the handler.

Need Elysia's own context — `status`, `set`, `cookie`, `store`, `redirect`,
plugin decorators? Take it with `@Ctx()`, typed by the declared schema:

```ts
import { Controller, Ctx, Post } from "@aponiajs/common";
import { type ElysiaRouteContext } from "@aponiajs/platform-elysia";
import { z } from "zod";

const createUser = { body: z.object({ name: z.string().min(2) }) };

@Controller("users")
export class UserController {
  @Post("/", createUser)
  create(@Ctx() context: ElysiaRouteContext<typeof createUser>) {
    context.set.headers["x-created"] = "1";
    return context.body.name === "root"
      ? context.status(403, "forbidden")
      : { name: context.body.name };
  }
}
```

## Native Elysia plugins

Existing Elysia plugins install as module imports and reach Elysia's `.use()`
unchanged:

```bash
bun add @elysiajs/cors @elysiajs/jwt
```

```ts
import { Module } from "@aponiajs/common";
import { ElysiaPluginModule } from "@aponiajs/platform-elysia";
import { cors } from "@elysiajs/cors";

@Module({
  imports: [ElysiaPluginModule.register(cors(), { key: "cors" })],
})
export class AppModule {}
```

A plugin that needs configuration resolves it from the container first:

```ts
import { Module } from "@aponiajs/common";
import { ElysiaPluginModule } from "@aponiajs/platform-elysia";
import { jwt } from "@elysiajs/jwt";
import { ConfigModule, ConfigService } from "./config/config.module.ts";

@Module({
  imports: [
    ElysiaPluginModule.registerAsync({
      key: "jwt",
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => jwt({ name: "jwt", secret: config.get("JWT_SECRET") }),
    }),
  ],
})
export class AuthModule {}
```

A stable `key` keeps a plugin imported by several modules installed once.
`AponiaFactory.create(AppModule, { configureNative })` and
`application.getNativeApplication()` hand back the Elysia instance itself when a
plugin needs it.

What a plugin decorates, stores, or derives is available in every handler at
runtime. Name the plugin to type it too:

```ts
import { Controller, Ctx, Get } from "@aponiajs/common";
import { type ElysiaRouteContext } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";

export const clock = new Elysia({ name: "clock" }).decorate("now", () => new Date().toISOString());

@Controller("health")
export class HealthController {
  @Get()
  read(@Ctx() context: ElysiaRouteContext<typeof clock>) {
    return { now: context.now() };
  }
}
```

A tuple types several plugins at once, and the second argument is only needed
when a route schema comes first:
`ElysiaRouteContext<typeof createUser, [typeof clock, typeof jwt]>`.

`defineElysiaPlugin` removes the ceremony entirely. It converts a native plugin
into a module import that carries its own type, so the plugin mounts directly
and annotates without `typeof`:

```ts
// src/clock.plugin.ts
export const clock = defineElysiaPlugin(
  new Elysia({ name: "clock" }).decorate("now", () => new Date().toISOString()),
  { key: "clock" },
);
export type clock = typeof clock;
```

```ts
import { type ElysiaRouteContext as e } from "@aponiajs/platform-elysia";
import { clock } from "./clock.plugin.ts";

@Controller("health")
export class HealthController {
  @Get()
  read(@Ctx() context: e<clock>) {
    return { now: context.now() };
  }
}

@Module({ imports: [clock], controllers: [HealthController] })
export class HealthModule {}
```

The [adapter README](./packages/platform-elysia/README.md) covers both forms and
the `AppContext<TSchema>` alias for applications that always mount the same
plugins.

## Test

An application answers a `Request` without binding a port, so tests exercise the
real graph and routes:

```ts
import { expect, test } from "bun:test";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

test("creates a user", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  const response = await application.handle(
    new Request("http://localhost/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    }),
  );

  expect(response.status).toBe(200);
});
```

More patterns, including asserting validation failures and `AponiaError` codes,
are in the [testing guide](./docs/testing.md).

## Generate

```bash
aponia new my-api
aponia generate module users
aponia generate resource users --type rest

aponia g mo users
aponia g res users
```

Every Nest schematic is available, from `class` and `controller` to `resource`
and `gateway`. A REST resource also generates `users.schema.ts` holding its route
validation, with both DTOs derived from it. See the
[CLI reference](./docs/cli.md) for the full catalog, aliases, and options.

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
exports, lifecycle management, structured logging, project generators, and
native Elysia escape hatches.

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
