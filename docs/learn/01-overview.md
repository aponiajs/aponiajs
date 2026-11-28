# 01 · Overview

**Use when:** starting with AponiaJS or deciding where a change belongs.

AponiaJS is a TypeScript framework for Bun. Applications are made of modules, providers, and controllers. Elysia is the default HTTP platform; Hono, H3, and Nitro are supported too.

## How it works

Decorators only write metadata. The runtime lowers that metadata into frozen descriptors, validates the module graph, and mounts native routes.

```text
@Module / @Controller / @Get  ->  reflect-metadata
compileRootModule             ->  ModuleDefinition / ControllerDefinition / Provider
compileModuleGraph            ->  validated graph
AponiaFactory.create          ->  running application
```

Each package owns one layer:

| Package                     | Owns                                   |
| --------------------------- | -------------------------------------- |
| `@aponiajs/common`          | Decorators, tokens, contracts, errors  |
| `@aponiajs/core`            | Module graph and dependency injection  |
| `@aponiajs/platform-elysia` | Elysia routes, plugins, and WebSockets |

Dependencies point one way: `common` → `core` → platform packages (`platform-elysia`, `platform-hono`, `platform-h3`).

## Descriptors are public API

Decorators are optional. `defineModule`, `defineController`, and the `provide*` helpers build the same descriptors by hand.

```ts
import { defineModule, provideClass } from "@aponiajs/common";

export const UsersModule = defineModule({
  id: "UsersModule",
  providers: [provideClass(UsersService, [])],
});
```

Both authoring paths stay supported.

## Errors happen at boot

The compiler rejects duplicate modules, import cycles, duplicate providers, invalid exports, and unresolved dependencies before the application listens. Failures throw `AponiaError` with a stable `code`.

Next: [02 · Install and generate](./02-install-and-generate.md) · Deep dive: [architecture and style](../build/architecture-and-style.md)
