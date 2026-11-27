# HTTP Platforms and Delivery Adapters

An Aponia application can run on one of two kinds of host. A **platform** boots
the module graph and mounts Aponia's own routes on a runtime, so validation,
guards, interceptors, filters, pipes, middleware, versioning, the prefix, SSE,
and lifecycle are the application's. A **delivery adapter** forwards a runtime's
request to an application already booted on a platform, and leaves routing there.

| Host                        | Kind     | Boots the graph | Owns routing |
| --------------------------- | -------- | --------------- | ------------ |
| `@aponiajs/platform-elysia` | Platform | yes             | yes          |
| `@aponiajs/platform-hono`   | Platform | yes             | yes          |
| `@aponiajs/platform-h3`     | Platform | yes             | yes          |
| `@aponiajs/serverless`      | Adapter  | no              | no           |
| `@aponiajs/nitro`           | Adapter  | no              | no           |

The three platforms are independent: each depends on `@aponiajs/common`,
`@aponiajs/core`, and its own runtime peer, and no
platform depends on another. `scripts/platform-independence.spec.ts` enforces
that. `@aponiajs/common` / `@aponiajs/core` supplies the shared material every platform
calls: descriptor lowering, validation, parameter binding, enhancer ordering,
pipes, filters, lifecycle, version negotiation, and the route handler each
native route runs. Each platform keeps only what its runtime owns — Elysia
registers native routes and hooks, Hono registers on Hono's router, H3 on H3's
router.
[Platform parity](./platform-parity.md) lists the deltas.

## Two adapter shapes

A platform binds one of two adapter shapes, and both return the same
`AponiaApplicationContract`: `handle`, `tryHandle`, `listen`, `getUrl`, `get`,
`getHttpAdapter`, `getHttpServer`, `close`, and the Nest configuration methods
(`useGlobalGuards`, `useGlobalInterceptors`, `useGlobalPipes`,
`useGlobalFilters`, `enableCors`, `useSecurityHeaders`, `setGlobalPrefix`,
`enableVersioning`, `enableShutdownHooks`, `useLogger`, `flushLogs`, and
`init`). A configuration method records its state and `init()` re-runs the boot
once. A delivery adapter is not a platform and keeps the narrower surface below.

- A **kernel host** (`KernelAdapter`) lowers the graph with
  `createPlatformFactory` and registers each compiled route on its own router.
  Hono and H3 are kernel hosts.
- An **application adapter** (`ApplicationAdapter`) keeps a runtime's native
  executor and boots through its own factory. Elysia is an application adapter,
  because its native validation, plugin composition, `HandlerContext`, and Eden
  types are part of its contract.

A new platform implements one of these shapes and passes the shared conformance
contract in `packages/platform-core/test/support/platform-contract.ts`.

## Platforms

One factory boots on any runtime. A platform package pre-binds its own adapter,
so the default platform reads exactly like Nest:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(3000);
application.getUrl();
application.getHttpAdapter(); // the runtime's own application object
```

A runtime that is not the default states its adapter. It can be the second
argument, the way `NestFactory.create(AppModule, new FastifyAdapter())` takes
one, or the `adapter` field of the options object:

```ts
import { AponiaFactory } from "@aponiajs/platform-core";
import { honoAdapter } from "@aponiajs/platform-hono";

const application = await AponiaFactory.create(AppModule, honoAdapter(), {
  prefix: "/api",
});

// The same boot, with the adapter as an option:
await AponiaFactory.create(AppModule, { adapter: honoAdapter(), prefix: "/api" });
```

The adapter values are `elysiaAdapter()`, `honoAdapter()`, and `h3Adapter()`.
This is the relationship Nest has between `NestFactory` and its platform
packages: `@aponiajs/platform-elysia` is the default HTTP platform, and each
other platform package ships the adapter value that selects its runtime.

| NestJS                                                | AponiaJS                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `NestFactory.create(AppModule)`                       | `AponiaFactory.create(AppModule)` from the platform package        |
| `NestFactory.create(AppModule, new ExpressAdapter())` | `AponiaFactory.create(AppModule, elysiaAdapter())`                 |
| `NestFactory.create(AppModule, new FastifyAdapter())` | `AponiaFactory.create(AppModule, honoAdapter())`, or `h3Adapter()` |

`application.listen(port)` resolves with the application itself, `getUrl()` states
the bound address, and `getHttpAdapter()` is the runtime's instance — the same
surface on every platform. The rest of the application object is mapped in
[Migrating from NestJS](../build/migrating-from-nest.md#the-application-object).

The Hono and H3 factories also expose `createNative`, which returns the runtime's
own application, and a middleware, which mounts a booted application inside an
existing one: `toHonoPlatformHandler(application)` and
`toH3PlatformHandler(application)`. Register the middleware after the ones that
must run first. A request Aponia has no route for continues down the chain
instead of being answered `404` by the platform.

## Delivery adapters

A delivery adapter mounts an application already booted on a platform inside
another runtime. It translates the delivery envelope only, so its documented
surface stays narrower than a platform's: `toNitroHandler(application)` and the
`@aponiajs/serverless` handlers forward requests to the application and return
its responses. They do not expose `listen`, `getUrl`, the Nest configuration
methods, or any other member of `AponiaApplicationContract`; configure and boot
the application on a platform first, then hand it to the adapter.

### Nitro

Nitro owns its server, so it is a delivery adapter rather than a peer platform.
Boot on a platform (H3 is the natural fit) and export the handler from a Nitro
server route:

```ts
// server/routes/[...all].ts
import { AponiaFactory } from "@aponiajs/platform-h3";
import { toNitroHandler } from "@aponiajs/nitro";
import { AppModule } from "../../app.module.ts";

const application = await AponiaFactory.create(AppModule, { logger: false });
export default toNitroHandler(application);
```

Nitro is experimental while its current release is an RC.

## Response policies

Four options apply at the request boundary on every platform:

```ts
const application = await AponiaFactory.create(AppModule, {
  cors: { origin: "https://app.example", credentials: true },
  securityHeaders: true,
  etag: true,
  compression: { threshold: 1024 },
});
```

| Option            | What it does                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `cors`            | Answers a preflight before routing and adds the CORS headers to every response.                                               |
| `securityHeaders` | Adds the framework defaults (`nosniff`, `SAMEORIGIN`, HSTS, and the rest); a string field overrides one and `false` drops it. |
| `etag`            | Adds a weak `ETag` by default and answers a matching `if-none-match` with `304`.                                              |
| `compression`     | Gzips a text-like response above the threshold when the client accepts it.                                                    |

They run at the same boundary on every platform, so `handle`, `listen`, and the
native application a boot returns answer alike. Preflight is decided before the
router; the other policies transform the final response, whatever produced it —
a route, a filter, the default Problem Details mapping, or a static file. None of
them reads the container or constructs a controller.

The limits are deliberate: compression is gzip only, `ETag` is SHA-1, and range
requests stay the runtime's. A host that cannot serve a request through the
pipeline would defer to its own answer; every shipped platform runs it.

## WebSockets

A gateway is a provider, so a platform that can upgrade runs it like any other
provider. Hono upgrades through `hono/bun`; H3 upgrades through `crossws`, on
both the H3 application and the Bun listener; Elysia uses its own capability. A
host whose runtime states no gateway support refuses the boot with
`UNSUPPORTED_PLATFORM_FEATURE` rather than mounting a route that never upgrades.

The handler surface is the one Nest applications already use. On Hono and H3,
`@MessageBody()` and `@ConnectedSocket()` bind the message,
`client.emit(event, data)` answers one client, and `@WebSocketServer()` gives a
server whose `emit(event, data)` broadcasts to every connected client. On Elysia,
`@ConnectedSocket()` is its native socket, so `send`, `publish`, and `subscribe`
are Elysia's. An ordinary handler result is emitted under the subscribed event on
every platform; `WsResponse` selects another event, `undefined` sends nothing, and
a failure is an `exception` frame with no stack or cause. The wire format is the
adapter's: a frame is `{ event, data }` JSON.

## Boundaries

A delivery adapter translates delivery only. It does not add a second dependency
injection container, route table, guard system, or WebSocket implementation.
Authentication, CORS, timeouts, and graceful shutdown remain the application's or
the runtime's responsibility.
