# @aponiajs/platform-h3

> AponiaJS on H3: the module graph, routes, validation, enhancers, and
> lifecycle run on the H3 runtime instead of Elysia.

## Use it through the unified factory

```ts
import { AponiaFactory } from "@aponiajs/platform-core";
import { h3Adapter } from "@aponiajs/platform-h3";

const application = await AponiaFactory.create(AppModule, { adapter: h3Adapter() });
await application.listen(3000);
```

The platform's own factory (`import { AponiaFactory } from "@aponiajs/platform-h3"`)
pre-binds this adapter.

## Use it

```ts
import { AponiaFactory } from "@aponiajs/platform-h3";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule, { prefix: "/api" });
```

`AponiaFactory.create` returns a managed application: `handle(request)` answers
through the kernel, `get(token)` resolves from the container, and `close()` runs
the shutdown passes. `AponiaFactory.createNative` returns the H3 instance.

## Mount it inside an existing H3 application

```ts
import { H3 } from "h3";
import { AponiaFactory, toH3PlatformHandler } from "@aponiajs/platform-h3";

const aponia = await AponiaFactory.create(AppModule);
const app = new H3();
app.use("*", logger());
app.use("*", toH3PlatformHandler(aponia));
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

## WebSocket gateways

A handler receives `@MessageBody()` and `@ConnectedSocket()`; `client.emit(event, data)`
answers one client, `@WebSocketServer()` gives a server whose `emit` broadcasts to
every client, and an ordinary result is emitted under the subscribed event.

A gateway mounts as an H3 route built with `defineWebSocketHandler`, which a
crossws-capable server upgrades; the Bun listener upgrades it through crossws
directly. The envelope is the same as on the other platforms: `{ event, data }`
in, an ordinary result under the subscribed event out, and an `exception` frame
with no stack or cause for a failure.

## Links

- [Repository guide](https://github.com/aponiajs/aponiajs/blob/release/beta/AGENTS.md)
- [Adapters](https://github.com/aponiajs/aponiajs/blob/release/beta/docs/adapters.md)
