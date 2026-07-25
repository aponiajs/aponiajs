# @aponiajs/platform-elysia

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
enhancers, schema aggregation, or the complete native-plugin compatibility
contract from the roadmap.

The decorator API is the default application authoring surface. The
`defineElysiaController` API remains available as a low-level escape hatch for
composing existing Elysia plugins without rewriting them.

See `docs/logging.md` for logger configuration, JSON output, level filtering,
and custom logger integration.
