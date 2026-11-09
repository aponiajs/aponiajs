# @aponiajs/nitro

Delivery adapter for Nitro.

```bash
bun add @aponiajs/nitro@beta
```

## Use it

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";
import { toNitroHandler } from "@aponiajs/nitro";

const application = await AponiaFactory.create(AppModule);
export default toNitroHandler(application);
```

The adapter forwards the runtime request to `application.handle`; Aponia's
container, routes, guards, validation, and filters stay in charge of the
response. The runtime owns its own middleware and deployment model.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Limits

The adapter translates delivery only. WebSockets remain Elysia-only, and the
runtime's own route table or middleware does not replace Aponia guards,
validation, or exception filters. Nitro support is experimental while the current Nitro release is an RC.
