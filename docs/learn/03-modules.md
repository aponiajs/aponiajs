# 03 · Modules

**Use when:** grouping a feature, or deciding what one part of an application
may see of another.

A module declares its controllers, its providers, the modules it imports, and
the providers it shares:

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

The root module composes features and is handed to the factory:

```ts
@Module({ imports: [UserModule] })
export class AppModule {}
```

## Visibility

A provider is visible to its own module always, and to another module when
it appears in `exports` and that module `imports` it.

For shared cross-cutting infrastructure (such as database or telemetry services), modules can be marked with `@Global()`, making their exported providers visible everywhere without explicit feature imports.

Two imported modules that resolve the token to different modules raise
`AMBIGUOUS_PROVIDER` instead of the framework picking a winner. Two that
re-export one shared provider agree on it, because both reach the same declaring
module, so routing one service through two feature modules is legal.

## Validation happens before the server starts

`compileModuleGraph` walks imports depth-first and rejects, at compile time:
duplicate module identity, import cycles, duplicate tokens inside a module,
exports of tokens the module cannot resolve, and unresolvable provider or
controller dependencies. A broken graph never reaches a listening port.

## Dynamic modules

A module configured at call time returns a descriptor instead of a class —
`PluginModule.register(plugin, { key })` is the built-in example. Modules
are identified by `instanceId ?? id`, so two configured instances of one class
stay distinct, and two sharing a key collide with `DUPLICATE_MODULE`.

Next: [04 · Providers and injection](./04-providers-and-injection.md) ·
Deep dive: [dependency injection](../dependency-injection.md)
