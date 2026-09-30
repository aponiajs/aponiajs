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
- Nest-style lifecycle hooks — `onModuleInit`, `onApplicationBootstrap`,
  `beforeApplicationShutdown`, `onModuleDestroy`, and `onApplicationShutdown` —
  read from the provider instance;
- Standard Schema route validation for `body`, `query`, `params`, `headers`,
  `cookie`, and default or status-specific `response` schemas;
- Nest-style request parameter decorators — `@Body()`, `@Query()`, `@Param()`,
  `@Headers()`, `@Cookie()`, `@Store()`, `@Req()`, `@Set()`/`@Res()`,
  `@Status()`, and `@Ctx()`;
- Nest-style startup logging for module initialization and route mapping;
- controller factories that return native Elysia plugins;
- application-owned native plugins mounted through `AponiaFactory.create`'s
  `plugins` option, beside the ones a module registers;
- concise `elysiaController(...)` registration with native callback inference;
- typed RFC 9457 application errors for every supported 4xx and 5xx status;
- Nest-style guards, interceptors (`interceptBefore`/`interceptAfter`), and
  exception filters, compiled into per-route Elysia lifecycle hooks;
- explicit Elysia lazy-composition and startup-precompile policy;
- `provideConfiguration(AppConfig)` — an application-declared configuration,
  validated once at boot and read back through `application.get(AppConfig)`;
- `handle`, `listen`, `get`, and `close` application methods.

This package intentionally does not yet implement request scopes, schema
aggregation, Socket.IO-only gateway semantics, or decorator-wide static route
inference.

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

### Declared gateways

A gateway can declare its path and handlers as data instead of through
decorators. This is the descriptor path's counterpart to `@WebSocketGateway()`
and `@SubscribeMessage()`, and it is what build-time descriptor generation
emits: the plan is compiled by the same bootstrap step, so the gateway reaches
the same path and event uniqueness checks, the same envelope, and the same
exception frames.

```ts
import { defineModule } from "@aponiajs/common";
import { defineElysiaWebSocketGateway } from "@aponiajs/platform-elysia";

const module = defineModule({
  id: "EventsModule",
  providers: [
    defineElysiaWebSocketGateway(EventsGateway, {
      path: "/events",
      handlers: [
        {
          event: "events.echo",
          propertyKey: "echo",
          parameters: [
            { index: 0, kind: "message-body", property: undefined },
            { index: 1, kind: "connected-socket", property: undefined },
          ],
        },
      ],
    }),
  ],
});
```

The class keeps its handler methods and its `afterInit`, `handleConnection`, and
`handleDisconnect`, which are resolved from the instance while the gateway is
bound and are therefore not part of a plan. `serverProperties` declares the
instance properties that receive the root Elysia application, as
`@WebSocketServer()` marks them. A plan never calls `application.ws()` itself —
`websockets/websocket-gateway.ts` remains the only module that does.

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
route and registers decorated routes directly on the root Elysia application.

A handler is compiled as Promise-capable unless its function kind or its emitted
`design:returntype` proves it returns synchronously. That matters because a
synchronous invoker returning a Promise gives `onAfterHandle` the raw `Promise`
rather than the resolved value, so the conservative default is the correct one.
The handler's own source is never inspected — minification and bundling can
change it, and a handler that merely returns a stored Promise carries no call
expression to recognize.

Use the `elysia` option to control Elysia's own route composition:

```ts
const application = await AponiaFactory.create(AppModule, {
  elysia: {
    precompile: {
      compose: true,
      schema: true,
    },
  },
});
```

`precompile: true`, or the granular object above, moves Elysia's route-specific
JavaScript composition before the application starts accepting traffic. Leaving
`precompile` disabled keeps Elysia composition lazy.

This is not native machine-code AOT. Elysia generates JavaScript, and
JavaScriptCore remains responsible for interpreter and machine-code JIT tiers.

### Build-time generated invokers

The `invokers` option consumes the artifact `aponia build` writes:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { controllerInvokerArtifact } from "./invokers.generated.ts";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule, {
  invokers: controllerInvokerArtifact,
});
```

The artifact carries its invokers keyed by controller class token, beside the
versions it was generated against:

```ts
// src/invokers.generated.ts
export const controllerInvokerArtifact = Object.freeze({
  framework: "1.0.0-beta.0",
  elysia: "2.0.0-beta.19",
  invokers: new Map([
    [UsersController, (instance: UsersController) => new Map([["ping", () => instance.ping()]])],
  ]),
});
```

The factory parameter is `never`, so a factory declared with a concrete
controller type is accepted without a cast, and an invoker's context parameter is
`never` for the same reason: an invoker reads the fields its own route declared,
so it is written against the application's annotations rather than against
`RouteContext`. An invoker that reads the context annotates the parameter itself
— `(context: RouteContext) => context.body` — because a parameter type that
accepts everything offers nothing to infer from. Class tokens and property keys
are used rather than names, so both survive minification and renamed files.

An artifact generated by another AponiaJS release is refused whole: bootstrap
reports the mismatch and compiles every route from decorator metadata, exactly as
it does when the option is omitted. A stale file therefore costs a cold start
rather than a wrong binding, and supplying an artifact can never turn a bootable
application into a failing one. The refusal names the Elysia the file was
generated against, or says that none could be resolved.

Supplying invokers is a substitution, never a requirement: a controller without
an entry, a handler whose property key is absent from its controller's map, and
a symbol-keyed handler are all compiled from decorator metadata exactly as they
are when the option is omitted. The supplied maps are read only, and an entry
for a token no controller uses is ignored.

### Build-time generated module descriptors

The `descriptors` option consumes the second artifact `aponia build` writes: the
application's module graph as data, so bootstrap can mount it without lowering
decorated classes at all. The entrypoint goes on naming the root module class:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { moduleDescriptorArtifact } from "./descriptors.generated.ts";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule, {
  descriptors: moduleDescriptorArtifact,
});
```

Bootstrap looks the module up by its class name and boots the declared graph when
it finds one, reporting the choice under `RoutesResolver`:

```text
[RoutesResolver] Booting AppModule from the generated module descriptors, so the declared graph serves this application.
```

The artifact holds the descriptors keyed by module class name, beside the versions
it was generated against:

```ts
// src/descriptors.generated.ts
export const moduleDescriptorArtifact = Object.freeze({
  framework: "1.0.0-beta.0",
  elysia: "2.0.0-beta.19",
  modules: Object.freeze({ AppModule: AppModuleDescriptor }),
});
```

Unlike invokers, this artifact is the whole graph rather than one handler at a
time, so the decision is made once and applies to the entire application. It is
used only when it is stamped with this release, carries a module record, and
holds a declaration for the root module the application named; in every other
case bootstrap lowers that module from its decorators, exactly as it does when
the option is omitted. A foreign or truncated file therefore costs the lowering
it was meant to remove rather than a boot that cannot start.

There is no freshness check. An artifact stamped with the running release is
adopted whole, so the graph it holds is the graph that serves until `aponia build`
refreshes it: a `descriptors.generated.ts` committed before a resource was
generated still describes the module graph from before that resource, which is
why the quick start runs `aponia build` before the first request. A module
renamed since the last build is a different case — the lookup is by the class
name the application passes, so the leftover entry under the old name is never
selected and the renamed root is lowered from its decorators.

### Declared routes

A controller can declare its routes as data instead of through decorators. This is
the descriptor path's counterpart to `@Controller()`, and it is what build-time
descriptor generation targets: the plans are compiled through the same lowering a
decorated controller uses, so the controller reaches the same native version
guard, the same duplicate-route check, the same startup logging, and the same
generated-invoker lookup.

```ts
import { defineModule, provideClass } from "@aponiajs/common";
import { defineElysiaControllerRoutes } from "@aponiajs/platform-elysia";

const module = defineModule({
  id: "UsersModule",
  providers: [provideClass(UsersService, [])],
  controllers: [
    defineElysiaControllerRoutes(UsersController, {
      path: "/users",
      inject: [UsersService],
      routes: [
        {
          method: "GET",
          path: ":id",
          propertyKey: "read",
          parameters: [{ index: 0, kind: "params", property: "id" }],
        },
      ],
    }),
  ],
});
```

Three facts a decorator reads out of emitted metadata are declared instead,
because a plan has no class to reflect on: `takesContext` decides whether a
handler with no decorated parameter receives the whole context, `promiseCapable`
decides whether the route awaits a returned Promise, and `guards`,
`interceptors`, and `filters` are the enhancers the controller or the handler
declares. Omitting `takesContext` means the handler receives nothing; omitting
`promiseCapable` means Promise-capable, which costs at most one already-settled
`await` and cannot change what a lifecycle hook observes. A plan's enhancer
arrays are the controller's own declarations — application-wide enhancers merge
while the route mounts, never into a compiled route. A plan never registers
itself on Elysia — the platform's own route compiler does, so the native version
guard stays in one place.

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

Errors a handler throws that no exception filter answers do not escape as a
stack trace either: every route the platform mounts from a compiled plan carries
a default Problem Details mapping last in its own error path, so they answer
`500` `application/problem+json` with a fixed `detail` and are reported through
the system logger under `ExceptionsHandler`. An answer Elysia's own error path
already decided is declined rather than translated, so a rejected request still
answers the native `422`, a failed `t.Transform` decode keeps its `422` and the
decode error's message, a thrown `status(...)` keeps its response, and an
`HttpError` keeps its own. The mapping only exists on routes the platform
mounted itself: a route a `registerRoutes` callback or a definition's own
`buildPlugin` mounted runs no declared filter and no mapping either.

## Downloads

A handler that returns a file streams it with a detected content type, `accept-ranges`,
and range support, but the response carries no name. `downloadFile` writes the one
header that names it and returns the value the platform already streams:

```ts
import { Controller, Get, Param, Set, type RouteResponseSettings } from "@aponiajs/common";
import { downloadFile } from "@aponiajs/platform-elysia";

@Controller("reports")
export class ReportController {
  @Get(":id")
  read(@Param("id") id: string, @Set() set: RouteResponseSettings) {
    return downloadFile(set, `/srv/reports/${id}.csv`, `${id}.csv`);
  }
}
```

The value follows RFC 6266 with the RFC 8187 extended parameter, so a name outside
ASCII is encoded rather than refused: `filename*` carries the name as UTF-8 and a
quoted ASCII fallback rides beside it. Pass `{ disposition: "inline" }` to render
instead of saving. A name carrying a line break, a NUL, or a path separator is refused
with a `TypeError` before any header is written.

## Execution enhancers

Guards, interceptors, and exception filters are declared like any other provider
and compile into the route's own Elysia hooks, so nothing wraps the handler:

```ts
import {
  Catch,
  Controller,
  Get,
  Injectable,
  Module,
  UseFilters,
  UseGuards,
  UseInterceptors,
  type AponiaInterceptor,
  type CanActivate,
  type ExceptionFilter,
  type ExecutionContext,
} from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";

@Injectable()
class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return context.switchToHttp().getRequest().headers.authorization === "Bearer secret";
  }
}

@Injectable()
class TimingInterceptor implements AponiaInterceptor {
  interceptAfter(_context: ExecutionContext, response: unknown): unknown {
    return response;
  }
}

class UserMissingError extends Error {}

@Catch(UserMissingError)
@Injectable()
class UserMissingFilter implements ExceptionFilter {
  catch(): unknown {
    return new Response("No such user.", { status: 404 });
  }
}

@Controller("users")
@UseGuards(AuthGuard)
@UseInterceptors(TimingInterceptor)
export class UsersController {
  @Get(":id")
  @UseFilters(UserMissingFilter)
  read(): string {
    throw new UserMissingError("no such user");
  }
}

@Module({
  controllers: [UsersController],
  providers: [AuthGuard, TimingInterceptor, UserMissingFilter],
})
class AppModule {}

const application = await AponiaFactory.create(AppModule);
```

A guard returning `false` refuses the request with a Problem Details `403` and
never calls the handler. An interceptor declares `interceptBefore` and
`interceptAfter` instead of Nest's `next.handle()`, and `interceptBefore` cannot
short-circuit. A filter answers the types its `@Catch()` named — or anything,
when it names none — and declines by returning `undefined` or `null`, the two
values Elysia's error path reads as no answer, so `false`, `0`, and `""` answer
with what they are. A declared filter is consulted for every exception its
`@Catch()` matches, an `HttpError`, a validation `422`, and a guard's refusal
included. Filters run most-specific-first, and the default Problem Details
mapping is always last: an application overrides it by declaring a filter ahead
of it, never by removing it.

Every enhancer must be a declared provider in a module the controller's module
can reach, and an undeclared one fails the boot with `MISSING_PROVIDER`. Global
enhancers are factory options — `guards`, `interceptors`, and `filters` — rather
than `useGlobal*` methods, because every route mounts during
`AponiaFactory.create`; a global enhancer runs before the ones a route declares
and resolves through the root module.

All of this reaches the routes the platform mounts from a compiled plan. A
controller registered through its own `registerRoutes` callback owns its routes'
hooks, and a definition mounted through its own `buildPlugin` resolves nothing,
so neither runs a declared enhancer, a global enhancer, or the default mapping.
See the [enhancers guide](../../docs/enhancers.md).

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

### The `plugins` option

An application can also mount a native plugin itself, without a module
declaring it:

```ts
const application = await AponiaFactory.create(AppModule, {
  plugins: [cors()],
});
```

Each entry takes the same `.use()` path a module-registered plugin takes, on the
same root application and at the same point in the boot — before any controller
mounts. Entries mount before the plugins the module graph contributes, and both
the request and the after-response phase run in mount order, so a hook an entry
declares runs before one a module's plugin declares. An entry may be
`undefined`, which mounts nothing: that is how a factory states a decision the
application made, and it is not the same as an inert plugin.

Nothing about a plugin mounted this way reaches the module graph — not
`compileRootModule`, not `inspectAponiaApplication`, not the artifacts
`aponia build` writes. `imports` is the place for a plugin a module can name,
and this option is for the ones it cannot: a plugin a call builds, which the
descriptor emitter declines as an `imports` entry, and a plugin chosen at boot
from configuration the module does not hold. It never resolves from the
container, so no entry can fail a boot.

### Typing what a plugin adds

Compiling a decorated controller erases the plugin instances its module imports,
so no plugin type reaches a handler on its own. Name the plugins in
`ElysiaRouteContext` and the context types what they add:

```ts
import { Controller, Ctx, Get } from "@aponiajs/common";
import { type ElysiaRouteContext } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";

export const clock = new Elysia({ name: "clock" })
  .decorate("now", () => new Date().toISOString())
  .state("requests", 0)
  .derive("global", () => ({ traceId: crypto.randomUUID() }));

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

A route that two different declarations claim — two controllers, or two handlers
of one controller — fails with `DUPLICATE_ROUTE` while the module graph
compiles, naming the method, the path, and both claimants. Elysia would
otherwise resolve the repeat by whichever registration wins, so the handler that
answered would depend on mount order. One declaration
reached through two modules is not a collision: a dynamic module merged onto a
decorated class reaches the controller twice and still registers one route. A
route a native plugin provides is outside the check, because a plugin mounts
through `use()` and a controller deliberately overriding one is Elysia's own
behavior.

## Inspecting an application

`inspectAponiaApplication` projects a root module into frozen, JSON-serializable
data — the module graph, every provider and its dependencies, every decorated
route with its parameter bindings, and every gateway:

```ts
import { inspectAponiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "./src/app.module.ts";

const inspection = inspectAponiaApplication(AppModule);
console.log(inspection.routes.map((route) => `${route.method} ${route.path}`));
```

It compiles the graph without constructing a single instance, so it is safe to
run against providers that open connections. Pass the `descriptors` artifact
`aponia build` wrote and the root is resolved through the same selector bootstrap
uses, so the inspection describes the graph the application actually serves; an
artifact this release refuses is reported through the `logger` option and the
decorated module is inspected instead. Routes registered by `elysiaController`
and `defineElysiaController` callbacks are not included, because their routes
only exist once the callback runs; build the application and read
`getNativeApplication().routes` for the complete native route table. See the
[introspection guide](../../docs/introspection.md) for the full contract.

[npm package](https://www.npmjs.com/package/@aponiajs/platform-elysia) ·
[configuration guide](../../docs/configuration.md) ·
[lifecycle guide](../../docs/lifecycle.md) ·
[native plugin guide](../../docs/native-plugins.md) ·
[Eden Treaty guide](../../docs/eden-treaty.md) ·
[complete package catalog](../../docs/packages.md)
