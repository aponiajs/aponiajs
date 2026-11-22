# @aponiajs/platform-hono

> AponiaJS on Hono: the module graph, routes, validation, enhancers, and
> lifecycle run on the Hono runtime instead of Elysia.

## Use it through the unified factory

```ts
import { AponiaFactory } from "@aponiajs/platform-core";
import { honoAdapter } from "@aponiajs/platform-hono";

const application = await AponiaFactory.create(AppModule, honoAdapter());
await application.listen(3000);
```

The adapter is the second argument, as `NestFactory.create` takes one; the
options form, `{ adapter: honoAdapter() }`, is equivalent.

The platform's own factory (`import { AponiaFactory } from "@aponiajs/platform-hono"`)
pre-binds this adapter.

## Use it

```ts
import { AponiaFactory } from "@aponiajs/platform-hono";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule, { prefix: "/api" });
```

`AponiaFactory.create` returns a managed application: `handle(request)` answers
through the platform's own router, `get(token)` resolves from the container, and `close()` runs
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

Middleware registered before Aponia's routes runs before its guards and
handlers, and a request Aponia has no route for continues to the application's
own routes.

## WebSocket gateways

A handler receives `@MessageBody()` and `@ConnectedSocket()`; `client.emit(event, data)`
answers one client, `@WebSocketServer()` gives a server whose `emit` broadcasts to
every client, and an ordinary result is emitted under the subscribed event.

A gateway mounts on the Hono application and upgrades through Hono's Bun
adapter. The JSON envelope is the same as on the Elysia platform: a client sends
`{ event, data }`, an ordinary result is emitted under the subscribed event, and
a failure is an `exception` frame with no stack or cause.

## What a consumer can rely on

- Routes, validation, guards, interceptors, filters, pipes, middleware, the
  route prefix, URI version mounts from `@Version()`, SSE, and lifecycle are the
  same contract as `@aponiajs/platform-elysia`.
- The `versioning` option's header and media-type negotiation and the health
  probes are shared with the other platforms. Inspection is the Elysia
  platform's and is not provided here.
- `downloadFile(settings, path, filename, options)` sets the shared
  `content-disposition` value and returns the file response.
- `staticAssets` serves directories with the shared path rule and headers.
- `cors`, `securityHeaders`, `etag`, and `compression` apply at the request
  boundary, so `handle`, `listen`, and a native instance answer alike.
- A route Aponia does not mount is answered by the runtime's own chain; the
  platform never answers `404` on the application's behalf.
- `listen` is Bun's server. The runtime is Bun, not Node.

## Links

- [Repository guide](https://github.com/aponiajs/aponiajs/blob/release/beta/AGENTS.md)
- [Adapters](https://github.com/aponiajs/aponiajs/blob/release/beta/docs/platforms/adapters.md)
