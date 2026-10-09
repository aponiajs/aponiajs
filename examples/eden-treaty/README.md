# Eden Treaty Example

This example demonstrates end-to-end type safety between backend and frontend
using Elysia's **Eden Treaty** with AponiaJS.

## Key Features

- **Path-Agnostic DTOs**: DTOs (`createDto`) are pure data transfer objects without any route path.
- **Dual Schema Support**: Validation schemas can be declared **inline** directly in decorators (e.g. `t.Object(...)`) or as **separated DTO classes** (e.g. `CreateUserDto`).
- **Standard Application Lifecycle**: The application bootstraps using the canonical `bootstrap()` function and `AponiaFactory.create(AppModule)` matching all other framework applications, while exporting `type App = ElysiaApplication<typeof AppModuleDescriptor>` for Eden Treaty.

## Run

Start the server:

```bash
bun run start
```

Run in watch mode:

```bash
bun run dev
```

Run end-to-end tests:

```bash
bun test
```
