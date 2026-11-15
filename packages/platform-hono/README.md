# @aponiajs/platform-hono

> AponiaJS on Hono: the module graph, routes, validation, enhancers, and
> lifecycle run on the Hono runtime instead of Elysia.

## Use it

```ts
import { AponiaFactory } from "@aponiajs/platform-hono";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule, { prefix: "/api" });
```

`AponiaFactory.create` returns a managed application: `handle(request)` answers
through the kernel, `get(token)` resolves from the container, and `close()` runs
the shutdown passes. `AponiaFactory.createNative` returns the Hono instance.

## Mount it inside an existing Hono application

```ts
import { Hono } from "hono";
import { AponiaFactory, toHonoPlatformHandler } from "@aponiajs/platform-hono";

const aponia = await AponiaFactory.create(AppModule);
const app = new Hono();
app.use("*", logger());
app.use("*", toHonoPlatformHandler(aponia));
app.get("/health", (context) => context.text("ok"));
```

Middleware registered before the dispatcher runs before Aponia's guards and
handlers, and a request the kernel has no route for continues to the
application's own routes.

## What a consumer can rely on

- Routes, validation, guards, interceptors, filters, pipes, middleware,
  versioning, the route prefix, SSE, and lifecycle are the same contract as
  `@aponiajs/platform-elysia`.
- The dispatcher declines a request it does not match; it never answers `404`
  on the application's behalf.
- `listen` is Bun's server. The runtime is Bun, not Node.

## Links

- [Repository guide](https://github.com/aponiajs/aponiajs/blob/release/beta/AGENTS.md)
- [Adapters](https://github.com/aponiajs/aponiajs/blob/release/beta/docs/adapters.md)
