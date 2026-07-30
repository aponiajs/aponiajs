# @aponiajs/platform-elysia

[![npm](https://img.shields.io/npm/v/%40aponiajs%2Fplatform-elysia)](https://www.npmjs.com/package/@aponiajs/platform-elysia)

## Install

```bash
bun add @aponiajs/common @aponiajs/platform-elysia elysia
```

The first Elysia platform slice for Aponia:

- `AponiaFactory.create(AppModule)` application bootstrap;
- `AponiaFactory.createNative(AppModule)` for the exact composed Elysia
  application and Eden Treaty inference;
- module-owned controller discovery;
- constructor-injected controllers;
- Nest-style `@Module()`, `@Controller()`, route, and `@Injectable()` metadata;
- automatic translation of decorated controllers into native Elysia routes;
- provider-registered Nest-style WebSocket gateways over Elysia `.ws()`;
- Standard Schema route validation for `body`, `query`, `params`, `headers`,
  `cookie`, and default or status-specific `response` schemas;
- Nest-style request parameter decorators — `@Body()`, `@Query()`, `@Param()`,
  `@Headers()`, `@Cookie()`, `@Store()`, `@Req()`, `@Set()`/`@Res()`,
  `@Status()`, and `@Ctx()`;
- Nest-style startup logging for module initialization and route mapping;
- controller factories that return native Elysia plugins;
- concise `elysiaController(...)` registration with native callback inference;
- typed RFC 9457 application errors for every supported 4xx and 5xx status;
- explicit Elysia AOT, lazy-composition, and startup-precompile policy;
- `handle`, `listen`, and `close` application methods.

This package intentionally does not yet implement request scopes, lifecycle
enhancers, schema aggregation, Socket.IO-only gateway semantics, or
decorator-wide static route inference from the roadmap.

Decorated modules, controllers, and validation models are the normal
application-authoring surface. Direct raw validators remain supported as a
schema escape hatch, `elysiaController(...)` exposes native Elysia inference
when it is specifically needed, and `defineElysiaController` remains the
advanced descriptor escape hatch.

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

## WebSocket gateways

```ts
import {
  ConnectedSocket,
  MessageBody,
  Module,
  SubscribeMessage,
  WebSocketGateway,
} from "@aponiajs/common";
import { AponiaFactory, type ElysiaWebSocket } from "@aponiajs/platform-elysia";

@WebSocketGateway("/events")
class EventsGateway {
  @SubscribeMessage("events.echo")
  echo(@MessageBody() data: unknown, @ConnectedSocket() client: ElysiaWebSocket): unknown {
    void client.id;
    return data;
  }
}

@Module({ providers: [EventsGateway] })
class AppModule {}

const application = await AponiaFactory.create(AppModule);
await application.listen(3000);
```

Clients send `{ "event": "events.echo", "data": value }` over
`ws://localhost:3000/events`. Gateways are normal singleton providers, so
constructor injection and module visibility stay identical to services.
`ElysiaWebSocket` exposes the real native client wrapper. See the
[WebSocket gateway guide](../../docs/websockets.md) for responses, lifecycle,
errors, and native publish/subscribe.

## Native application and Eden Treaty

`createNative` returns the real composed Elysia instance. A statically declared
module retains route types from `defineElysiaPlugin`, typed controller plugins,
imported descriptor modules, and `configureNative`:

```ts
import { defineModule } from "@aponiajs/common";
import { AponiaFactory, defineElysiaPlugin } from "@aponiajs/platform-elysia";
import { Elysia, t } from "elysia";

const routes = defineElysiaPlugin(
  new Elysia({ name: "routes" }).get("/health", () => ({ status: "ok" as const }), {
    response: t.Object({ status: t.Literal("ok") }),
  }),
  { key: "routes" },
);

const AppModule = defineModule({
  id: "AppModule",
  imports: [routes],
});

export const app = await AponiaFactory.createNative(AppModule);
export type App = typeof app;

app.listen(3000);
```

The client stays identical to native Eden:

```ts
import { treaty } from "@elysia/eden";
import type { App } from "@backend/server.ts";

export const api = treaty<App>("http://localhost:3000");
```

Tests can call `treaty(app)` directly without opening a port. No contract
adapter, assertion, or custom fetcher is required. Decorated routes still run
normally, but their runtime metadata cannot contribute TypeScript route
generics without the planned build-time compiler. See the
[Eden Treaty guide](../../docs/eden-treaty.md) for controller injection, tests,
and the exact inference boundary.

## Route compilation policy

Aponia compiles decorator metadata and parameter binding once during bootstrap.
The generated controller invoker exposes only the context fields used by that
route, keeps synchronous handlers synchronous, and registers decorated routes
directly on the root Elysia application.

Use the `elysia` option to control Elysia's own route composition:

```ts
const application = await AponiaFactory.create(AppModule, {
  elysia: {
    aot: true,
    precompile: {
      compose: true,
      schema: true,
    },
  },
});
```

`aot: true` enables Elysia's route-specific JavaScript composition.
`precompile: true`, or the granular object above, moves that composition before
the application starts accepting traffic. Leaving `precompile` disabled keeps
Elysia composition lazy. Set `aot: false` only when the generic dynamic Elysia
dispatcher is required for compatibility.

These settings are not native machine-code AOT. Elysia generates JavaScript,
and JavaScriptCore remains responsible for interpreter and machine-code JIT
tiers. They are also distinct from a future Aponia build-time source emitter.

### The shortest type-safe controller

`elysiaController` skips decorator reflection and gives its callback Elysia's
normal contextual typing. Dependency tuples stay literal without `as const`,
and route schemas infer `body`, `query`, `params`, `store`, `set`, and `status`
inside the callback without a manual context type or `typeof`:

```ts
import { defineModule, provideClass } from "@aponiajs/common";
import { elysiaController } from "@aponiajs/platform-elysia";
import { t } from "elysia";

const usersController = elysiaController(UsersController, [UsersService], (app, controller) =>
  app.state("requests", 0).post(
    "/users",
    ({ body, store, status }) => {
      store.requests += 1;
      return status(201, controller.create(body.name));
    },
    {
      body: t.Object({ name: t.String() }),
    },
  ),
);

const AppModule = defineModule({
  id: "AppModule",
  controllers: [usersController],
  providers: [provideClass(UsersService, [])],
});
```

The callback receives the root Elysia application after native plugin modules
have been mounted. Return the fluent chain to preserve its route contract
through `createNative()` and Eden Treaty. The returned controller definition is
frozen and also carries an automatically generated `buildPlugin` fallback.
Use this native-registration escape hatch when its route inference is more
important than the normal decorated-controller structure.

`defineElysiaController(..., { registerRoutes })` remains available when a build
tool needs the explicit descriptor shape or a diagnostic `path`.
`defineElysiaController(..., { buildPlugin })` remains available for a
controller that intentionally owns an isolated plugin.

## Application errors

Throw a default error by intent instead of constructing `Response` objects or
maintaining an application-wide error switch:

```ts
import { httpError, httpErrors } from "@aponiajs/platform-elysia";

throw httpErrors.notFound("User 42 does not exist.", {
  code: "USER_NOT_FOUND",
});

throw httpError(422, "The submitted profile is invalid.", {
  code: "PROFILE_INVALID",
  extensions: { field: "email" },
});
```

`httpErrors` has an autocomplete-friendly factory for every 4xx and 5xx status
exported by the supported Elysia version, including
`badRequest`, `unauthorized`, `notFound`, `conflict`,
`unprocessableContent`, `tooManyRequests`, `internalServerError`, and
`serviceUnavailable`. Numeric codes and standard status names are both
accepted by `httpError`.

Every `HttpError` is handled by Elysia's native `toResponse()` path and returns
`application/problem+json` with `type`, `title`, `status`, `detail`, and a stable
`code` extension. Optional `instance`, headers, custom extensions, and a
server-side `cause` are supported. The response never serializes the error
stack or cause, and reserved Problem Details members cannot be replaced through
extensions.

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

### Named validation models

Associate one native or Standard Schema validator with each named request
contract, then use the class directly in a route schema:

```ts
import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Validation,
  type InferValidatorOutput,
} from "@aponiajs/common";
import { t } from "elysia";
import { z } from "zod";

const createUserSchema = t.Object({ name: t.String({ minLength: 2 }) });
const updateUserSchema = z.object({ displayName: z.string().min(3) });
const userParamsSchema = t.Object({ id: t.Numeric({ minimum: 1 }) });

@Validation(createUserSchema)
class CreateUser {}
interface CreateUser extends InferValidatorOutput<typeof createUserSchema> {}

@Validation(updateUserSchema)
class UpdateUser {}
interface UpdateUser extends InferValidatorOutput<typeof updateUserSchema> {}

@Validation(userParamsSchema)
class UserParams {}
interface UserParams extends InferValidatorOutput<typeof userParamsSchema> {}

@Controller("users")
class UserController {
  @Post("/", { body: CreateUser })
  create(@Body() body: CreateUser) {
    return body;
  }

  @Patch(":id", { params: UserParams, body: UpdateUser })
  update(@Param("id") id: number, @Body() body: UpdateUser) {
    return { id, ...body };
  }

  @Delete(":id", { params: UserParams })
  remove(@Param("id") id: number) {
    return { id };
  }
}
```

The model classes name separate create, update, and path-parameter contracts;
`DELETE` validates its path params and does not invent a request body. During
bootstrap, Aponia unwraps each class once and passes the exact original
validator to Elysia. An undecorated class fails bootstrap with
`INVALID_VALIDATION_MODEL`. Direct schemas such as
`@Post("/", { body: z.object(...) })` remain supported for imported validators
and low-level integrations.

`@Validation()` records runtime metadata; it does not add TypeScript instance
properties to the class. The same-named interfaces above merge the validator
output into each model once, so controller methods only need the model name.
`ElysiaRouteContext<typeof routeSchema>` and
`ElysiaStatus<typeof routeSchema>` also lower those model classes at the type
boundary, preserving native body, params, cookie, and response-status inference.

Use the native-named parameter decorators when a method needs only those hot
path fields:

```ts
import { Set, Status, Store } from "@aponiajs/common";
import {
  type ElysiaSet,
  type ElysiaStatus,
  type ElysiaStore,
} from "@aponiajs/platform-elysia";

read(
  @Store() store: ElysiaStore<typeof clock>,
  @Set() set: ElysiaSet,
  @Status() status: ElysiaStatus,
) {
  store.requests += 1;
  set.headers["x-source"] = "aponia";
  return status(202, { requests: store.requests });
}
```

`@Res()` is retained as the Nest-style alias of `@Set()`. Each part is read
directly from the native Elysia context by the compiled invoker; Aponia does not
create a request wrapper or argument array.

Keep a route method parameterless when it needs no request data; the adapter
leaves unused context fields off that hot path. On a method with no parameter
decorators, a single unannotated parameter receives the whole context, as does
`@Ctx()` explicitly.

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

### Dropping `typeof` in decorated controllers

The `elysiaController(...)` callback shown above is the simple path: Elysia
infers the request context directly, so no context annotation or `typeof` is
needed. The aliases below exist for decorated methods, where TypeScript cannot
contextually infer a method parameter from a decorator.

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
preserves Elysia's accumulated plugin types on `createNative()` and
`getNativeApplication()`.

## Bootstrap diagnostics

A controller descriptor with a platform kind other than
`aponia.elysia.controller` fails with `UNSUPPORTED_CONTROLLER`. A recognized
Elysia controller whose `buildPlugin` factory returns something other than an
Elysia instance fails with `INVALID_CONTROLLER`. Both are reported during
`AponiaFactory.create`, before the application can listen.

[npm package](https://www.npmjs.com/package/@aponiajs/platform-elysia) ·
[native plugin guide](../../docs/native-plugins.md) ·
[Eden Treaty guide](../../docs/eden-treaty.md) ·
[complete package catalog](../../docs/packages.md)
