# @aponiajs/platform-elysia

[![npm](https://img.shields.io/npm/v/%40aponiajs%2Fplatform-elysia)](https://www.npmjs.com/package/@aponiajs/platform-elysia)

## Install

```bash
bun add @aponiajs/common @aponiajs/platform-elysia elysia
```

The first Elysia platform slice for Aponia:

- `AponiaFactory.create(AppModule)` application bootstrap;
- module-owned controller discovery;
- constructor-injected controllers;
- Nest-style `@Module()`, `@Controller()`, route, and `@Injectable()` metadata;
- automatic translation of decorated controllers into native Elysia routes;
- Standard Schema route validation for `body`, `query`, `params`, `headers`,
  and `response`;
- Nest-style request parameter decorators — `@Body()`, `@Query()`, `@Param()`,
  `@Headers()`, `@Cookie()`, `@Req()`, `@Res()`, and `@Ctx()`;
- Nest-style startup logging for module initialization and route mapping;
- controller factories that return native Elysia plugins;
- `handle`, `listen`, and `close` application methods.

This package intentionally does not yet implement request scopes, lifecycle
enhancers, schema aggregation, or the complete module-level native-plugin
contract from the roadmap.

The decorator API is the default application authoring surface.
`defineElysiaController` remains available as a low-level escape hatch for
controller factories.

See `docs/logging.md` for logger configuration, JSON output, level filtering,
and custom logger integration.

```ts
import { Module } from "@aponiajs/common";
import { AponiaFactory, ElysiaPluginModule } from "@aponiajs/platform-elysia";

@Module({})
class AppModule {}

async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule);
  await application.listen(3000);
}

await bootstrap();
```

## Routes with the native Elysia context

Controllers are Nest-shaped: a route decorator declares the method, path, and
schema, and parameter decorators inject the request. Types come from the
handler's own annotations.

```ts
import { Body, Controller, Ctx, Param, Post } from "@aponiajs/common";
import { type ElysiaRouteContext } from "@aponiajs/platform-elysia";
import { z } from "zod";

const createUser = { body: z.object({ name: z.string().min(2) }) };
type CreateUser = z.infer<(typeof createUser)["body"]>;

@Controller("users")
class UserController {
  @Post("/", createUser)
  createUser(@Body() body: CreateUser, @Param("tenant") tenant: string) {
    return { tenant, name: body.name };
  }

  @Post("native", createUser)
  createNatively(@Ctx() context: ElysiaRouteContext<typeof createUser>) {
    context.set.headers["x-created"] = "1";
    return context.body.name === "root"
      ? context.status(403, "forbidden")
      : { name: context.body.name };
  }
}
```

`ElysiaRouteContext<typeof schema>` is Elysia's own context type narrowed by the
declared schema, so `status`, `set`, `cookie`, `store`, `redirect`, and plugin
decorators behave exactly as they do in a plain Elysia handler.

## Native Elysia plugins

Use existing Elysia plugins through Nest-style module imports:

```bash
bun add @elysiajs/cors @elysiajs/jwt
```

```ts
import { Module } from "@aponiajs/common";
import { ElysiaPluginModule } from "@aponiajs/platform-elysia";
import { cors } from "@elysiajs/cors";

@Module({
  imports: [
    ElysiaPluginModule.register(cors(), {
      key: "cors",
    }),
  ],
})
class AppModule {}
```

The plugin is passed unchanged to Elysia's native `.use()` implementation. For
plugins that depend on an injectable service, use an async registration:

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
      useFactory: (config: ConfigService) =>
        jwt({
          name: "jwt",
          secret: config.get("JWT_SECRET"),
        }),
    }),
  ],
})
class AuthModule {}
```

Imported plugins are installed in dependency order before controllers and a
shared configured module is installed once across diamond imports. A stable
`key` keeps module diagnostics deterministic and prevents duplicate
registrations with the same key.

### Typing what a plugin adds

Compiling a decorated controller erases the plugin instances its module imports,
so no plugin type reaches a handler on its own. Name the plugins in the second
type argument of `ElysiaRouteContext` and the context types what they add:

```ts
import { Controller, Ctx, Get } from "@aponiajs/common";
import { type ElysiaRouteContext } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";

export const clock = new Elysia({ name: "clock" })
  .decorate("now", () => new Date().toISOString())
  .state("requests", 0)
  .derive({ as: "global" }, () => ({ traceId: crypto.randomUUID() }));

@Controller("health")
class HealthController {
  @Get()
  read(@Ctx() context: ElysiaRouteContext<typeof clock>) {
    context.store.requests += 1;
    return { now: context.now(), traceId: context.traceId };
  }
}
```

The first argument takes either the plugins or a route schema, so a handler
without a schema never writes an empty one. A tuple covers several plugins, and
the second argument is only needed when both are typed:

```ts
ElysiaRouteContext<[typeof clock, typeof cache]>;
ElysiaRouteContext<typeof createUser, typeof clock>;
```

An application that always mounts the same plugins declares the pairing once and
keeps every handler short:

```ts
// src/app.context.ts
import { type ElysiaInputSchema, type ElysiaRouteContext } from "@aponiajs/platform-elysia";
import { cache } from "./cache.plugin.ts";
import { clock } from "./clock.plugin.ts";

export type AppContext<TSchema extends ElysiaInputSchema = {}> = ElysiaRouteContext<
  TSchema,
  [typeof clock, typeof cache]
>;
```

```ts
@Get()
read(@Ctx() context: AppContext) {}

@Post("/", createUser)
create(@Ctx() context: AppContext<typeof createUser>) {}
```

### Dropping `typeof`

`defineElysiaPlugin` converts a native plugin into a module import that also
carries the plugin type. Export it beside a same-named type and the plugin is
usable in both a value and a type position:

```ts
// src/clock.plugin.ts
import { defineElysiaPlugin } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";

export const clock = defineElysiaPlugin(
  new Elysia({ name: "clock" }).decorate("now", () => new Date().toISOString()),
  { key: "clock" },
);
export type clock = typeof clock;
```

The import goes straight into `imports`, with no `ElysiaPluginModule.register`
around it, and the annotation needs no `typeof`. Rename the context type on
import for the shortest form:

```ts
import { Controller, Ctx, Get, Module } from "@aponiajs/common";
import { type ElysiaRouteContext as e } from "@aponiajs/platform-elysia";
import { cache } from "./cache.plugin.ts";
import { clock } from "./clock.plugin.ts";

@Controller("health")
class HealthController {
  @Get()
  read(@Ctx() context: e<clock>) {
    return { now: context.now() };
  }

  @Get("cached")
  readCached(@Ctx() context: e<[clock, cache]>) {
    return { cached: context.cache.read("health") };
  }
}

@Module({ imports: [clock, cache], controllers: [HealthController] })
class HealthModule {}
```

`ElysiaPluginModule.register` and `registerAsync` stay available and unchanged;
`defineElysiaPlugin` is `register` plus the plugin it installs, and the context
type accepts either form. The plugin instance itself remains reachable as
`clock.plugin`.

The mapping follows Elysia's own `.use()` rule, so what is typed is exactly what
arrives at runtime: `decorate`, `state`, `resolve`, and `derive` declared
`global`, plus `scoped` derives and resolves. A plugin-local derive stays inside
the plugin and is absent from both the type and the context. Naming no plugin
costs nothing at runtime — the values are still there, only untyped.

`configureNative` remains available as an application-level escape hatch. It
preserves Elysia's accumulated plugin types on `getNativeApplication()`.

[npm package](https://www.npmjs.com/package/@aponiajs/platform-elysia) ·
[complete package catalog](../../docs/packages.md)
