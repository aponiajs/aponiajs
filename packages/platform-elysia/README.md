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
import { AponiaFactory, ElysiaPluginModule } from "@aponiajs/platform-elysia";

@Module({})
class AppModule {}

const application = await AponiaFactory.create(AppModule);
await application.listen(3000);
```

## Native Elysia plugins

Use existing Elysia plugins through Nest-style module imports:

```bash
bun add @elysiajs/cors @elysiajs/jwt
```

```ts
import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";

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

`configureNative` remains available as an application-level escape hatch. It
preserves Elysia's accumulated plugin types on `getNativeApplication()`.
Module-imported plugin state and decorators are available at runtime, but do
not yet flow into decorated controller parameter types.

[npm package](https://www.npmjs.com/package/@aponiajs/platform-elysia) ·
[complete package catalog](../../docs/packages.md)
