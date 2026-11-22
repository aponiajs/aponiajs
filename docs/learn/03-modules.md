# 03 · Modules

**Use when:** grouping a feature or controlling what another module can see.

A module declares its controllers, providers, imports, and exports:

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

The root module composes features and is passed to the factory:

```ts
@Module({ imports: [UserModule] })
export class AppModule {}
```

## Visibility

A provider is visible inside its own module. Another module sees it only when this module exports it and the other module imports this module.

`@Global()` makes a module's exports visible to every module. Use it for shared infrastructure such as configuration or telemetry.

Two imports that resolve one token to different modules raise `AMBIGUOUS_PROVIDER`. Two imports of the same re-exported provider are valid.

## Validation

`compileModuleGraph` walks imports depth-first and rejects duplicate module identities, import cycles, duplicate tokens, invalid exports, and unresolved dependencies. A broken graph never reaches `listen()`.

## Dynamic modules

A module configured at call time returns a descriptor. `PluginModule.register(plugin)` is the built-in example.

Module identity is `instanceId ?? id`. Two configured instances of one class stay distinct, and registering the same key twice raises `DUPLICATE_MODULE`.

Next: [04 · Providers and injection](./04-providers-and-injection.md) · Deep dive: [dependency injection](../build/dependency-injection.md)
