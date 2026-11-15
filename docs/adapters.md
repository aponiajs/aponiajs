# HTTP Platforms and Delivery Adapters

An Aponia application can run on one of two kinds of host. A **platform** boots
the module graph and mounts Aponia's own routes on a runtime, so validation,
guards, interceptors, filters, pipes, middleware, versioning, the prefix, SSE,
and lifecycle are the application's. A **delivery adapter** forwards a runtime's
request to an application already booted on Elysia, and leaves routing there.

| Host                        | Kind     | Boots the graph | Owns routing |
| --------------------------- | -------- | --------------- | ------------ |
| `@aponiajs/platform-elysia` | Platform | yes             | yes          |
| `@aponiajs/platform-hono`   | Platform | yes             | yes          |
| `@aponiajs/platform-h3`     | Platform | yes             | yes          |
| `@aponiajs/platform-nitro`  | Platform | yes             | yes          |
| `@aponiajs/serverless`      | Adapter  | no              | no           |
| `@aponiajs/hono`            | Adapter  | no              | no           |
| `@aponiajs/h3`              | Adapter  | no              | no           |
| `@aponiajs/nitro`           | Adapter  | no              | no           |

The platforms share one kernel: `@aponiajs/platform-core` owns routing,
decoding, validation, the enhancer pipeline, and lifecycle. A platform states
only what its runtime owns — how the native application is created, how the
dispatcher is mounted, and how a request and a gateway are answered.
[Platform parity](./platform-parity.md) lists the deltas.

## Platforms

One factory boots on any runtime; the adapter states which one:

```ts
import { AponiaFactory } from "@aponiajs/platform-core";
import { honoAdapter } from "@aponiajs/platform-hono";

const application = await AponiaFactory.create(AppModule, {
  adapter: honoAdapter(), // or elysiaAdapter(), h3Adapter(), nitroAdapter()
  prefix: "/api",
});
await application.listen(3000);
application.getUrl();
application.getHttpAdapter(); // the runtime's own application object
```

`application.listen(port)` resolves with the application itself, `getUrl()` states
the bound address, and `getHttpAdapter()` is the runtime's instance — the same
surface on every platform. Each platform package also exports a convenience
factory that pre-binds its own adapter, for an application that never switches.

The Hono and H3 factories also expose `createNative`, which returns the runtime's
own application, and a middleware, which mounts a booted application inside an
existing one: `toHonoPlatformHandler(application)` and
`toH3PlatformHandler(application)`. Register the middleware after the ones that
must run first. A request Aponia has no route for continues down the chain
instead of being answered `404` by the platform.

Nitro serves an H3 application, so `@aponiajs/platform-nitro` exports the handler
a server route uses:

```ts
// server/routes/[...all].ts
import { AponiaFactory, createAponiaNitroHandler } from "@aponiajs/platform-nitro";

const application = await AponiaFactory.create(AppModule, { logger: false });
export default createAponiaNitroHandler(application);
```

## Delivery adapters

An application already booted on Elysia can be mounted inside another runtime.

### Hono

```ts
import { createHonoApp } from "@aponiajs/hono";

const host = createHonoApp(application);
export default host;
```

Hono middleware registered before the catch-all route runs before the Aponia
handler. A route Hono answers itself does not reach the application.

### H3

```ts
import { H3 } from "h3";
import { toH3Handler } from "@aponiajs/h3";

const host = new H3().use(toH3Handler(application));
```

### Nitro

Export the handler from a Nitro server route:

```ts
// server/routes/[...all].ts
import { toNitroHandler } from "@aponiajs/nitro";

export default toNitroHandler(application);
```

Nitro is experimental while its current release is an RC.

## WebSockets

A gateway is a provider, so a platform that can upgrade runs it like any other
provider. Hono upgrades through `hono/bun`; H3 upgrades through `crossws`, both
on the H3 application (which Nitro's crossws server upgrades) and on the Bun
listener; Elysia uses its own capability. A host whose runtime states no gateway
support refuses the boot with `UNSUPPORTED_PLATFORM_FEATURE` rather than mounting
a route that never upgrades.

The handler surface is the one Nest applications already use: `@MessageBody()`
and `@ConnectedSocket()` bind the message, `client.emit(event, data)` answers one
client, `@WebSocketServer()` gives a server whose `emit(event, data)` broadcasts
to every connected client, and an ordinary handler result is emitted under the
subscribed event. `WsResponse` still selects another event, `undefined` sends
nothing, and a failure is an `exception` frame with no stack or cause. The wire
format is the adapter's: the kernel encodes a frame as `{ event, data }` JSON.

## Boundaries

A delivery adapter translates delivery only. It does not add a second dependency
injection container, route table, guard system, or WebSocket implementation.
Authentication, CORS, timeouts, and graceful shutdown remain the application's or
the runtime's responsibility.
