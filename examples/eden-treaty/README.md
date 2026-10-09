# Eden Treaty Example

This example demonstrates end-to-end type safety between backend and frontend
using Elysia's **Eden Treaty** with AponiaJS.

## Key Features

- **Path-Agnostic DTOs**: DTOs (`createDto`) are pure data transfer objects without any route path.
- **Dual Schema Support**: Validation schemas can be declared **inline** directly in decorators (e.g. `t.Object(...)`) or as **separated DTO classes** (e.g. `CreateUserDto`).
- **Zero-Boilerplate Route Export**: The application exports its native Elysia instance and typed route tree (`EdenApp`) for `treaty<App>()`.

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
