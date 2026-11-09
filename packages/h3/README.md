# @aponiajs/h3

Delivery adapter for H3.

```bash
bun add @aponiajs/h3@beta
```

## Use it

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";
import { toH3Handler } from "@aponiajs/h3";

const application = await AponiaFactory.create(AppModule);
import { H3 } from "h3";

const host = new H3().use(toH3Handler(application));
export default host;
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
validation, or exception filters.
