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
import { AponiaFactory } from "@aponiajs/platform-elysia";

@Module({})
class AppModule {}

const application = await AponiaFactory.create(AppModule);
await application.listen(3000);
```

## Native Elysia plugins

Use existing Elysia plugins without an Aponia adapter:

```bash
bun add @elysiajs/cors
```

```ts
import { cors } from "@elysiajs/cors";

const application = await AponiaFactory.create(AppModule, {
  configureNative: (elysia) => elysia.use(cors()),
});
```

`configureNative` receives the real Elysia application before Aponia mounts its
controllers. Use Elysia's own `.use()` API for instance, functional, array, and
lazy plugins; no adapter or route copying is involved. Return the same
application so Elysia's plugin types remain available from
`application.getNativeApplication()`.

[npm package](https://www.npmjs.com/package/@aponiajs/platform-elysia) ·
[complete package catalog](../../docs/packages.md)
