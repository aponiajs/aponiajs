# Delivery Adapters

An Aponia application answers `Request` with `Response`. The delivery adapters
forward a runtime's request to `application.handle`, so the compiled container,
route table, guards, validation, and filters remain the application's own. The
runtime keeps its middleware and deployment model in front of that handler.

## Hono

```ts
import { createHonoApp } from "@aponiajs/hono";

const host = createHonoApp(application);
export default host;
```

Hono middleware registered before the catch-all route runs before the Aponia
handler. A route Hono answers itself does not reach the application.

## H3

```ts
import { H3 } from "h3";
import { toH3Handler } from "@aponiajs/h3";

const host = new H3().use(toH3Handler(application));
```

## Nitro

Export the handler from a Nitro server route:

```ts
// server/routes/[...all].ts
import { toNitroHandler } from "@aponiajs/nitro";

export default toNitroHandler(application);
```

Nitro is experimental while its current release is an RC. The adapter returns a
Nitro server-route handler; Nitro keeps its own route table, middleware, and
deployment model, and Aponia does not generate Nitro routes or tasks.

## Boundaries

The adapters translate delivery only. They do not add a second dependency
injection container, route table, guard system, or WebSocket implementation.
WebSockets remain an Elysia platform feature. Authentication, CORS, timeouts,
and graceful shutdown remain the application's or the runtime's responsibility.
