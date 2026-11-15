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

```ts
import { AponiaFactory } from "@aponiajs/platform-hono";

const application = await AponiaFactory.create(AppModule, { prefix: "/api" });
application.listen?.(3000);
```

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
provider. Hono upgrades through its Bun adapter, which the host loads lazily; on
a runtime where that adapter is unavailable, the host states no gateway support.
H3 and Nitro answer a graph that declares a gateway with
`UNSUPPORTED_PLATFORM_FEATURE` rather than mounting a route that never upgrades;
the Elysia platform remains the WebSocket reference. The client protocol is the
same JSON envelope on every platform: a client sends `{ event, data }`, an
ordinary result is emitted under the subscribed event, and a failure is an
`{ event: "exception", data: { code, message } }` frame with no stack or cause.

## Boundaries

A delivery adapter translates delivery only. It does not add a second dependency
injection container, route table, guard system, or WebSocket implementation.
Authentication, CORS, timeouts, and graceful shutdown remain the application's or
the runtime's responsibility.
