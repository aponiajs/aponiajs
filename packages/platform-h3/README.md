# @aponiajs/platform-h3

> AponiaJS on H3: the module graph, routes, validation, enhancers, and
> lifecycle run on the H3 runtime instead of Elysia.

## Use it through the unified factory

```ts
import { AponiaFactory } from "@aponiajs/platform-core";
import { h3Adapter } from "@aponiajs/platform-h3";

const application = await AponiaFactory.create(AppModule, h3Adapter());
await application.listen(3000);
```

The adapter is the second argument, as `NestFactory.create` takes one; the
options form, `{ adapter: h3Adapter() }`, is equivalent.

The platform's own factory (`import { AponiaFactory } from "@aponiajs/platform-h3"`)
pre-binds this adapter.

## Use it

```ts
import { AponiaFactory } from "@aponiajs/platform-h3";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule, { prefix: "/api" });
```

`AponiaFactory.create` returns a managed application: `handle(request)` answers
through the platform's own router, `get(token)` resolves from the container, and `close()` runs
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

Middleware registered before Aponia's routes runs before its guards and
handlers, and a request Aponia has no route for continues to the application's
own routes.

## What a consumer can rely on

- Routes, validation, guards, interceptors, filters, pipes, middleware, the
  route prefix, URI version mounts from `@Version()`, SSE, and lifecycle are the
  same contract as `@aponiajs/platform-elysia`.
- The managed application carries the same Nest surface as the Elysia platform:
  `useGlobalGuards`, `useGlobalInterceptors`, `useGlobalPipes`,
  `useGlobalFilters`, `enableCors`, `useSecurityHeaders`, `setGlobalPrefix`,
  `enableVersioning`, `enableShutdownHooks`, `useLogger`, `flushLogs`,
  `getHttpServer`, and `init()`. A configuration method records its state and
  `init()` re-runs the boot once; `getHttpServer()` is the bound Bun server after
  `listen`. The repository's delivery adapters keep their narrower documented
  surface.
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
- [Adapters](https://github.com/aponiajs/aponiajs/blob/release/beta/docs/platforms/adapters.md)
