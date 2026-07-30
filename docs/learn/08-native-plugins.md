# 08 · Native plugins

**Use when:** reusing an existing Elysia plugin, or adding something to the
request context that every controller can read.

For a plugin owned by one controller, use the native callback path and let
Elysia infer everything:

```ts
const healthController = elysiaController(HealthController, (app) =>
  app.use(clock).get("/health", ({ now }) => ({ now: now() })),
);
```

That form needs no manual context type or `typeof`.

For a plugin shared by several controllers, convert it into a module import once
and mount it:

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

```ts
@Module({ imports: [clock], controllers: [HealthController] })
export class AppModule {}
```

The `key` is the plugin's identity: two modules importing the same keyed plugin
install it once, and two different plugins sharing a key raise
`DUPLICATE_MODULE`.

## Typing what it adds

Compiling a decorated controller erases the plugin instances a module imports,
so name the plugins in the context type:

```ts
@Get()
read(@Ctx() context: ElysiaRouteContext<clock>) {
  return { now: context.now() };
}
```

The first type argument takes either the plugins or a route schema, a tuple
covers several, and the second argument is only needed when both matter. A
plugin exported through `defineElysiaPlugin` beside a same-named type needs no
`typeof`.

## What actually reaches a controller

`decorate`, `state`, and `global` or `scoped` derives and resolves arrive and are
typed. A plugin-local derive stays inside the plugin, and the type mapping
excludes it for exactly that reason.

## Plugins that need configuration

`ElysiaPluginModule.registerAsync` builds the plugin from the container, so it
can read a `ConfigService` before constructing the plugin.

Next: [09 · Logging](./09-logging.md) ·
Deep dive: [native plugins](../native-plugins.md)
