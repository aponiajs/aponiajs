# @aponiajs/platform-nitro

> AponiaJS on Nitro: the H3 platform's host, exposed as the server handler a
> Nitro route exports.

## Use it through the unified factory

```ts
import { AponiaFactory } from "@aponiajs/platform-core";
import { nitroAdapter } from "@aponiajs/platform-nitro";

const application = await AponiaFactory.create(AppModule, { adapter: nitroAdapter() });
await application.listen(3000);
```

The platform's own factory (`import { AponiaFactory } from "@aponiajs/platform-nitro"`)
pre-binds this adapter.

## Use it

```ts
// server/routes/[...all].ts
import { AponiaFactory, createAponiaNitroHandler } from "@aponiajs/platform-nitro";
import { AppModule } from "../../src/app.module.ts";

const application = await AponiaFactory.create(AppModule, { logger: false });
export default createAponiaNitroHandler(application);
```

`AponiaFactory.create` boots the graph and returns the managed application;
`AponiaFactory.createNative` returns the H3 application Nitro serves.

## What a consumer can rely on

- Nitro owns the server: the application never listens.
- Routes, validation, guards, interceptors, filters, pipes, middleware,
  versioning, the prefix, SSE, and lifecycle are the same contract as
  `@aponiajs/platform-elysia` and `@aponiajs/platform-h3`.
- A request Aponia has no route for is answered `404` by the handler when used
  as the catch-all route, or continues to the next Nitro handler when mounted
  as middleware.

## WebSocket gateways

A gateway mounts as an H3 route built with `defineWebSocketHandler`, which a
crossws-capable server upgrades; the Bun listener upgrades it through crossws
directly. The envelope is the same as on the other platforms: `{ event, data }`
in, an ordinary result under the subscribed event out, and an `exception` frame
with no stack or cause for a failure.

## Links

- [Repository guide](https://github.com/aponiajs/aponiajs/blob/release/beta/AGENTS.md)
- [Adapters](https://github.com/aponiajs/aponiajs/blob/release/beta/docs/adapters.md)
