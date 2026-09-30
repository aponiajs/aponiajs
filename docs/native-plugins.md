# Native Elysia Plugins

Every Elysia plugin works inside an AponiaJS application unchanged. A plugin
becomes a module import, the platform passes it to Elysia's own `.use()`, and
what it adds to the request context reaches every controller.

## Mounting a plugin

`definePlugin` converts a native plugin into a module import:

```ts
// src/clock.plugin.ts
import { definePlugin } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";

export const clock = definePlugin(
  new Elysia({ name: "clock" })
    .decorate("now", () => new Date().toISOString())
    .state("requests", 0)
    .derive("global", () => ({ traceId: crypto.randomUUID() })),
  { key: "clock" },
);
export type clock = typeof clock;
```

```ts
import { Module } from "@aponiajs/common";
import { clock } from "./clock.plugin.ts";

@Module({ imports: [clock] })
export class AppModule {}
```

The same value is also a complete descriptor import:

```ts
import { defineModule } from "@aponiajs/common";

export const AppModule = defineModule({
  id: "AppModule",
  imports: [clock],
});
```

A published plugin is mounted the same way:

```ts
import { cors } from "@elysiajs/cors";

export const corsPlugin = definePlugin(cors(), { key: "cors" });
export type corsPlugin = typeof corsPlugin;
```

`PluginModule.register(plugin, { key })` is the same registration without
the plugin type attached, and stays supported. Use `definePlugin` unless a
handler never needs the plugin's types.

The `key` is the plugin's identity in the module graph. Two modules importing
the same keyed plugin install it once; two different plugins sharing one key
raise `DUPLICATE_MODULE` at compile time, before the server listens.

## The `plugins` option

A plugin whose source no module can name still has somewhere to go:
`AponiaFactory.create` mounts it directly, beside the ones the module graph
contributes.

```ts
const application = await AponiaFactory.create(AppModule, {
  plugins: [cors()],
});
```

What it mounts is the same `.use()` on the same root application, at the same
point in the boot: before any controller mounts. Entries mount before the
plugins the module graph contributes, and both the request and the
after-response phase run in mount order, so a hook an entry declares runs before
one a module's plugin declares.

What it is not is part of the module graph. No module declares it, so nothing
about it reaches `compileRootModule`, `inspectAponiaApplication`, or the
artifacts `aponia build` writes. `imports` stays the place for a plugin a module
can name (`definePlugin`, `PluginModule.register`); this option is
for the plugins a module cannot:

- the plugin a call builds. `aponia build` lowers a module only when every
  `imports` entry names its declaration with a single identifier, so
  `SomeModule.register(...)` in an `imports` array declines the module that
  wrote it, and a declined _root_ leaves the committed descriptor artifact
  serving a graph the registration is not in.
- the plugin the application decides on at boot, from a configuration the
  module does not hold.

An entry may be `undefined`, and one that is mounts nothing. That is the shape a
factory states a decision with: a registration the application chose not to
enable answers `undefined` rather than an inert plugin, so a boot cannot mistake
it for an enabled one. Every other entry reaches Elysia unchanged, and nothing
resolves from the container on this path — an entry is the plugin value itself,
not a token, so no entry can fail a boot.

[Typing what a plugin adds](#typing-what-a-plugin-adds) works the same way here
as it does for an import; the type travels on the handler's annotation rather
than through a module registration the plugin has no part in.

## The no-annotation path

When a plugin belongs to one controller, compose it in an
`controller(...)` callback exactly as native Elysia does:

```ts
import { defineModule } from "@aponiajs/common";
import { controller } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";

const clock = new Elysia({ name: "clock" })
  .decorate("now", () => new Date().toISOString())
  .state("requests", 0);

class HealthController {}

const healthController = controller(HealthController, (app) =>
  app.use(clock).get("/health", ({ now, store }) => {
    store.requests += 1;
    return { now: now(), requests: store.requests };
  }),
);

export const HealthModule = defineModule({
  id: "HealthModule",
  controllers: [healthController],
});
```

The callback is contextually typed by Elysia, so plugin decorators and store
arrive without a manual context type, `typeof`, or a local alias. Use the module
imports below when a plugin is shared by several controllers or needs injected
configuration.

## Plugins that need injected configuration

`PluginModule.registerAsync` builds the plugin from the container, so it
can read configuration a provider owns:

```ts
import { Module } from "@aponiajs/common";
import { PluginModule } from "@aponiajs/platform-elysia";
import { jwt } from "@elysiajs/jwt";
import { ConfigModule, ConfigService } from "./config/config.module.ts";

@Module({
  imports: [
    PluginModule.registerAsync({
      key: "jwt",
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => jwt({ name: "jwt", secret: config.get("JWT_SECRET") }),
    }),
  ],
})
export class AuthModule {}
```

`imports` lists the modules whose exports the factory resolves against. A token
that no imported module exports fails with `MISSING_PROVIDER`.

A package that wraps a plugin for other applications builds its module this way,
then registers more than a plugin. See
[Authoring a Plugin Package](./plugin-packages.md).

## Typing what a plugin adds

Compiling a decorated controller erases the plugin instances a module imports,
so no plugin type reaches a handler on its own. Name the plugins in
`HandlerContext` and the context types them:

```ts
import { Context, Controller, Get } from "@aponiajs/common";
import { type HandlerContext } from "@aponiajs/platform-elysia";
import { clock } from "./clock.plugin.ts";

@Controller("health")
export class HealthController {
  @Get()
  read(@Context() context: HandlerContext<clock>) {
    context.store.requests += 1;
    return { now: context.now(), traceId: context.traceId };
  }
}
```

The first type argument takes either the plugins or a route schema, so a route
without a schema never writes an empty one:

| Annotation                                        | Types                      |
| ------------------------------------------------- | -------------------------- |
| `HandlerContext`                                  | neither                    |
| `HandlerContext<clock>`                           | one plugin                 |
| `HandlerContext<[clock, cache]>`                  | several plugins            |
| `HandlerContext<typeof createUser>`               | the route schema           |
| `HandlerContext<typeof createUser, [clock, jwt]>` | the schema and the plugins |

A plugin exported through `definePlugin` beside a same-named type is
usable in a type position directly, which is why the examples above need no
`typeof` at each use site. TypeScript cannot contextually type a decorated
method parameter from decorator metadata, so the export declares the alias
once. A plugin exported only as a `const` is written
`HandlerContext<typeof clock>`.

Rename the context type on import when the annotation should be shorter still:

```ts
import { type HandlerContext as e } from "@aponiajs/platform-elysia";

read(@Context() context: e<clock>) {}
```

## Declaring the pairing once

An application that always mounts the same plugins declares one alias and keeps
every handler short:

```ts
// src/app.context.ts
import { type RouteInputSchema, type HandlerContext } from "@aponiajs/platform-elysia";
import { cache } from "./cache.plugin.ts";
import { clock } from "./clock.plugin.ts";

export type AppContext<TSchema extends RouteInputSchema = {}> = HandlerContext<
  TSchema,
  [clock, cache]
>;
```

```ts
@Get()
read(@Context() context: AppContext) {}

@Post("/", createUser)
create(@Context() context: AppContext<typeof createUser>) {}
```

AponiaJS deliberately has no framework-level plugin registry. Ambient
registration through declaration merging would apply to a whole compilation,
including files that never mount the plugin, so the pairing stays an
application-owned alias.

## What is typed, and what actually arrives

The mapping follows Elysia's own `.use()` rule, so the type matches runtime
exactly:

| Declared in the plugin         | Reaches a controller | Typed |
| ------------------------------ | -------------------- | ----- |
| `.decorate(...)`               | yes                  | yes   |
| `.state(...)`                  | yes                  | yes   |
| `.derive("global", ...)`       | yes                  | yes   |
| `.derive("plugin", ...)`       | yes                  | yes   |
| `.derive(...)` without a scope | no                   | no    |

Elysia 2 states the scope as a string — `derive("global", ...)`,
`derive("plugin", ...)`, or a bare `derive(...)` — and no longer carries
`resolve`, whose timing belongs to `derive`. The 1.4 object form
(`.derive({ as: "global" }, ...)`) no longer compiles.

A plugin-local derive stays inside the plugin, because a controller is mounted
beside the plugin rather than inside it. Naming no plugin costs nothing at
runtime — the values are still in the context, only untyped.

## Reaching Elysia directly

Return the native application directly when Elysia or Eden should own the
calling surface:

```ts
const native = await AponiaFactory.createNative(AppModule, {
  configureNative: (application) =>
    application.onError(({ error }) => ({ message: String(error) })),
});
```

The managed lifecycle facade remains available:

```ts
const application = await AponiaFactory.create(AppModule, {
  configureNative: (native) => native.onError(({ error }) => ({ message: String(error) })),
});

const native = application.getNativeApplication();
```

`configureNative` must return the instance it receives. Both `createNative` and
`getNativeApplication` keep the accumulated Elysia types of whatever
`configureNative` returned.

## Testing a plugin-backed route

An application answers a `Request` without binding a port, so a test asserts the
plugin's effect through the route that consumes it:

```ts
import { expect, test } from "bun:test";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

test("exposes the clock decorator", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/health"));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ now: expect.any(String) });
});
```

`packages/platform-elysia/tests/plugin-context.test.ts` and
`plugin-definition.test.ts` exercise every case above, including compile-time
assertions that fail `bun run check` when a plugin type is lost or widened.

[Authoring a plugin package](./plugin-packages.md) ·
[Architecture and style](./architecture-and-style.md) ·
[Eden Treaty](./eden-treaty.md) ·
[Testing](./testing.md) ·
[Adapter README](../packages/platform-elysia/README.md)
