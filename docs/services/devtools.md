# Devtools

`@aponiajs/devtools` serves a read-only view of what a running AponiaJS
application is: the graph it compiled, the routes it serves, the stages each
route runs, the lines it logged, and the requests it answered. It is a leaf
package an application opts into on purpose; nothing in the framework depends on
it.

## Use it

```ts
import { Module } from "@aponiajs/common";
import { DevtoolsModule } from "@aponiajs/devtools";

@Module({
  imports: [DevtoolsModule.forRoot({ enabled: Bun.env.NODE_ENV !== "production" })],
})
export class AppModule {}
```

The surface answers under `/__devtools` on the address the application already
answers on, so it is reachable wherever the application is and it answers
through `application.handle(new Request(...))` as well as `listen()`. There is
no second server and no port option.

`enabled: false` is an inert module: no provider, no controller, and therefore
no route. The framework never reads an environment variable to choose its own
behaviour; registration is the opt-in and `enabled` is the switch.

## Endpoints

| Path                   | Answers                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `/__devtools`          | the HTML page                                                      |
| `/__devtools/meta`     | contract version, the boot release, artifact stamps                |
| `/__devtools/graph`    | the compiled modules, providers, controllers, routes, and gateways |
| `/__devtools/routes`   | every compiled plan and callback route the boot recorded           |
| `/__devtools/flow`     | each route's stages and filters                                    |
| `/__devtools/aot`      | the build verdict for the project, when the record carries one     |
| `/__devtools/logs`     | the bounded log stream, read from a cursor                         |
| `/__devtools/requests` | the bounded request record, read from a cursor                     |

Every endpoint is a `GET`. A path the surface does not own is `404`; a non-`GET`
request through the router is also `404`, because the surface mounts explicit
routes rather than a wildcard. `handleDevtoolsRequest`, the dispatcher behind the
mount, still answers `405` for a non-`GET` request when it is handed one
directly.

## Options

| Option      | Meaning                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`   | whether the surface mounts at all                                                                                                                                                    |
| `authorize` | a predicate run before every endpoint; `false` answers `401` with `cache-control: no-store` and no handler runs                                                                      |
| `logger`    | the logger whose lines `/logs` records. Pass the object the factory received; `false` or omitted publishes no stream                                                                 |
| `capture`   | what `/requests` records: `enabled`, `headers`, `body`, `bodyLimit`, `redact`. `false` is shorthand for `{ enabled: false }` and still serves `/requests`, answering an empty record |

## How it is neutral

The surface is a controller and the request record is a
`RequestLifecycleHook` (`onRequest`, `onResponse`, `onError`). Every payload is
projected from the neutral boot record the platform publishes — compiled plans,
callback routes, global enhancers, interceptor halves, and gateway plans — so the
same registration answers the same way on `@aponiajs/platform-elysia`,
`@aponiajs/platform-hono`, `@aponiajs/platform-h3`, and the Web Fetch serverless
handler. No source file imports a platform package, and
`scripts/plugin-standard.spec.ts` holds that.

`test/platform-parity.spec.ts` in the package boots the same registration on all
four and asserts the same statuses, contract version, route list, HTML page, and
`404` for an unknown path.

## Documented degradations

These are stated rather than hidden, and none of them branches on a platform
name — each is a fact of the neutral record:

- **Contributed native hooks are not reported.** A plugin's own `derive`,
  `resolve`, native `transform`, `beforeHandle`, or `afterHandle` contribution is
  not part of the neutral boot record. `/flow` publishes a route's compiled plan
  stages — validation, guards, interceptor halves, binding, handler, filters —
  and no contributed-hook stage.
- **Routes mounted outside the graph are not reported.** `/routes` and `/flow`
  describe the plans and callback routes the boot recorded. A route registered
  directly on a native application is absent, and `/routes` no longer reads a
  native route table.
- **A non-`GET` request through the router answers `404`.** Mounting explicit
  routes replaces the dispatcher's `405` on that path; the dispatcher itself
  still answers `405`.
- **Request bodies are stored as the text that arrived**, not as the parsed
  value. `store` and request-scoped `state` snapshots are not recorded.
- **A mapped exception's message appears when the platform publishes one.** The
  neutral record carries `mappedExceptions` where the boot has it; the failure
  entry otherwise states the status and no message.
- **Two registrations under distinct keys** are two graph nodes; each serves the
  surface at the same prefix, so the boot refuses the duplicate route. One
  registration per application is the supported shape.

## Verification

```bash
bun test packages/devtools
bunx --bun vp test packages/devtools/test
bun run --cwd examples/devtools test
```

The Bun lane boots real applications and drives the surface through
`application.handle`; the Vite+ lane pins the published types.

## Related

- [Devtools chapter](../learn/14-devtools.md)
- [Platform parity](../platforms/platform-parity.md)
- [Plugin package authoring](../tooling/plugin-packages.md)
