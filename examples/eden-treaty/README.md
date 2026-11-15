# Eden Treaty Example

This example demonstrates end-to-end type safety between backend and frontend
using Elysia's **Eden Treaty** with AponiaJS.

## Key Features

- **Pure Schemas with Zero Wrappers**: Uses `z.object(...)` and `t.Object(...)` directly without needing `createDto` or any wrappers.
- **Direct Decorator Integration**: Validation schemas can be declared **inline** directly in decorators or imported as shared schema constants.
- **Standard Application Lifecycle**: The application bootstraps using the canonical `bootstrap()` function and `AponiaFactory.create(AppModule)` matching all other framework applications.

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
