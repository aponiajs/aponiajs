# @aponiajs/platform-nitro

> AponiaJS on Nitro: the H3 platform's host, exposed as the server handler a
> Nitro route exports.

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

## Links

- [Repository guide](https://github.com/aponiajs/aponiajs/blob/release/beta/AGENTS.md)
- [Adapters](https://github.com/aponiajs/aponiajs/blob/release/beta/docs/adapters.md)
