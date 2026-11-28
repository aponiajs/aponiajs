# 13 · Native plugins

**Use when:** reusing an Elysia plugin or adding request context for every controller.

For a plugin owned by one controller, use the native callback and let Elysia infer the context:

```ts
const healthController = controller(HealthController, (app) =>
  app.use(clock).get("/health", ({ now }) => ({ now: now() })),
);
```

For a plugin shared by several controllers, convert it into a module import once:

```ts
// src/clock.plugin.ts
import { definePlugin } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";

export const clock = definePlugin(
  new Elysia({ name: "clock" }).decorate("now", () => new Date().toISOString()),
  { key: "clock" },
);
export type clock = typeof clock;
```

```ts
@Module({ imports: [clock], controllers: [HealthController] })
export class AppModule {}
```

`key` is the plugin identity. Two modules importing the same keyed plugin install it once. Two different plugins sharing a key raise `DUPLICATE_MODULE`.

## Typing the additions

Compiling a decorated controller erases plugin instances, so name the plugins in the context type:

```ts
@Get()
read(@Context() context: HandlerContext<clock>) {
  return { now: context.now() };
}
```

The first type argument accepts one plugin, a tuple of plugins, or a route schema. A plugin exported through `definePlugin` beside a same-named type needs no `typeof`.

`decorate`, `state`, and global or scoped derives and resolves reach the controller. A plugin-local derive stays inside the plugin.

## Configuration

`PluginModule.registerAsync` builds the plugin from the container, so it can read a `ConfigService` before construction.

Next: [14 · Devtools](./14-devtools.md) · Deep dive: [native plugins](../platforms/native-plugins.md)
