# @aponiajs/devtools

```bash
bun add @aponiajs/devtools
```

The opt-in devtools surface for a running AponiaJS application: what the
application compiled, what it answers, and what it logged, served under
`/__devtools` on the address the application already answers on.

## Use it

```ts
import { Module } from "@aponiajs/common";
import { DevtoolsModule } from "@aponiajs/devtools";

@Module({
  imports: [DevtoolsModule.forRoot({ enabled: Bun.env.NODE_ENV !== "production" })],
})
export class AppModule {}
```

`enabled: false` is an inert module — no provider and no controller, so no
route either.

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Endpoints

| Path                   | Answers                                           |
| ---------------------- | ------------------------------------------------- |
| `/__devtools`          | the HTML page                                     |
| `/__devtools/meta`     | contract version, boot release, artifact stamps   |
| `/__devtools/graph`    | modules, providers, controllers, routes, gateways |
| `/__devtools/routes`   | compiled plans and callback routes                |
| `/__devtools/flow`     | each route's stages and filters                   |
| `/__devtools/aot`      | build verdicts for the project                    |
| `/__devtools/logs`     | the bounded log stream, read from a cursor        |
| `/__devtools/requests` | the bounded request record, read from a cursor    |

## Options

| Option      | Meaning                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`   | whether the surface mounts at all                                                                                                                                              |
| `authorize` | a predicate run before every endpoint; `false` is `401`                                                                                                                        |
| `logger`    | the logger whose lines `/logs` records. Pass the same value the factory received; `false` or omitted publishes no stream                                                       |
| `capture`   | what `/requests` records: `enabled`, `headers`, `body`, `bodyLimit`, `redact`. `false` is shorthand for `{ enabled: false }` and still serves `/requests` with an empty record |

## How it is platform-neutral

The surface is a controller and the request record is a
`RequestLifecycleHook`. Every payload is projected from the neutral boot record
the platform publishes — compiled plans, callback routes, enhancers, interceptor
halves, and gateway plans — so the same registration answers the same way on
`@aponiajs/platform-elysia`, `@aponiajs/platform-hono`, `@aponiajs/platform-h3`,
and the Web Fetch serverless handler. No source file imports a platform package.

## Documented degradations

- **Contributed native hooks are not reported.** `/flow` publishes a route's
  compiled plan stages; a plugin's own `derive`, `resolve`, `transform`,
  `beforeHandle`, or `afterHandle` contribution is not part of the neutral
  record and is absent.
- **Routes mounted outside the graph are not reported.** A route registered
  directly on a native application is not a compiled plan and does not appear in
  `/routes` or `/flow`.
- **A non-`GET` request through the router answers `404`.** The surface mounts
  explicit routes; `handleDevtoolsRequest` still answers `405` when invoked
  directly.
- **A request body is recorded as the text that arrived**, not as a parsed
  value. `store` and request-scoped `state` snapshots are not recorded.
- **A mapped exception's message appears when the platform publishes one**; the
  neutral record carries `mappedExceptions` where the boot has it.

## Requirements

Bun is the runtime. `/aot` reads the project from disk with Bun's own file APIs.

## Related

- [Devtools](../../docs/services/devtools.md)
- [Platform parity](../../docs/platforms/platform-parity.md)
