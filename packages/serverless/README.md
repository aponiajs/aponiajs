# @aponiajs/serverless

Serverless adapters for AponiaJS: a Web Fetch handler for worker runtimes and
an AWS Lambda handler for API Gateway HTTP API (payload 2.0) and REST API
(payload 1.0).

```bash
bun add @aponiajs/serverless@beta
```

## In an Aponia application

Build the application once at module scope, then hand it to the handler the
runtime expects:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule, {
  logger: ["error", "warn"],
});
```

`application.handle` is the same entrypoint `listen` uses, so a serverless
handler exercises the real container, routes, guards, and filters.

## Web Fetch

An Aponia application already answers `Request` with `Response`, so a worker
runtime mounts it directly:

```ts
import { toFetchHandler } from "@aponiajs/serverless";
import { application } from "./application.ts";

const handle = toFetchHandler(application);
export default { fetch: handle };
```

## AWS Lambda

```ts
import { createLambdaHandler } from "@aponiajs/serverless";
import { application } from "./application.ts";

export const handler = createLambdaHandler(application);
```

`handler` answers both proxy event versions. The event becomes a standard
`Request`: `rawPath`/`path`, the query string, headers, `cookies`, and a body
decoded from base64 when the gateway says it is encoded. The `Response` becomes
the proxy result: a text content type whose bytes are valid UTF-8 travels as
text, every other body travels base64, so a binary response is never corrupted.

`set-cookie` headers become the payload 2.0 `cookies` array or the payload 1.0
`multiValueHeaders` entry, because both gateways drop duplicate header names.
Every other header keeps its single value.

## Limits

The adapter translates the gateway envelope; it adds no authentication, CORS,
or timeout policy of its own, and it does not run the application's graceful
shutdown (a serverless invocation has no process to drain). Configure those at
the gateway and in the application.
