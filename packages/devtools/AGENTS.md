# @aponiajs/devtools — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The opt-in devtools surface for a running application: the module an application
imports, the controller mounted under `/__devtools`, the request record, and the
HTTP API that reports what the running application actually is. The persistence
is a `DynamicModule`; this package is a leaf, and nothing in the framework
depends on it. `@aponiajs/cli` is loaded only when `/aot` is polled.

| Domain        | Owns                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------- |
| `module/`     | `DevtoolsModule.forRoot`, `DevtoolsOptions`, the controller and the lifecycle hook          |
| `server/`     | `createHandlers`, the handler record, `handleDevtoolsRequest`, the dispatcher               |
| `endpoints/`  | one payload builder per endpoint, the neutral inspection projection, and the shared readers |
| `buffer/`     | the bounded cursor buffer `/logs` and `/requests` share                                     |
| `logging/`    | the log stream, its bound, and the logger tap                                               |
| `requests/`   | the request record, its bound, and the capture that fills it                                |
| `source/`     | source lookup, location, and component implementation extraction                            |
| `interfaces/` | the type-only contracts every other domain in the package implements                        |

`src/index.ts` is the only public barrel. Type-only contracts live as
`interfaces/<name>.interface.ts`; a runtime module stays beside the domain that
owns it.

## Invariants

- **Registration is the whole opt-in.** `enabled` is the switch; the framework
  never reads an environment variable to choose its own behaviour. A disabled
  registration is inert: no provider, no controller, no route.
- **The surface is a controller and the record is a lifecycle hook.** No source
  file imports a platform package. `/__devtools/meta` and the other endpoints are
  ordinary `GET` routes; a request to the prefix is answered by the application
  like any other route.
- **Every payload is projected from the neutral boot record.** `/graph`,
  `/routes`, and `/flow` read `BOOT_DIAGNOSTICS` — compiled plans, callback
  routes, global enhancers, interceptor halves, and gateway plans — and never a
  native route table. The record is read on the first request, after the boot
  published it.
- **The request record is filled by the hook.** `onRequest` stamps the arrival,
  `onResponse` writes the answer, and `onError` writes a failure. Requests to the
  surface's own prefix are excluded. The body is stored as the text that arrived.
- **`authorize` runs before every endpoint.** A false answer is `401` with
  `cache-control: no-store`, and no endpoint handler sees the request.
- **Documented degradations are stated, not hidden.** Contributed native hooks
  are not in the neutral record and are not published as `/flow` stages; a route
  mounted outside the graph is not reported; the controller's explicit routes
  make a non-`GET` request a routing `404` (the dispatcher still answers `405`
  directly); request `store`/`state` snapshots are not recorded; a mapped
  exception message appears only when the platform publishes `mappedExceptions`.
- **`/aot` owns two facts.** The boot half is the record's; the other half is
  `@aponiajs/cli`'s project analysis, reached through a dynamic import on the
  first request and cached for the life of the process.
- The log stream is built at registration, before the boot writes, and the
  logger is patched in place rather than replaced. A logger no level can be
  patched on earns no `/logs` endpoint.
- Every endpoint is a `GET`; a path the handler record does not own is `404`.
  Nothing this package serves mutates application state.

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+, and
`test/platform-parity.spec.ts` across `platform-elysia`, `platform-hono`,
`platform-h3`, and the serverless Web Fetch handler. Bun cases boot real
applications with `DevtoolsModule.forRoot` and drive the surface through
`application.handle`; payload assertions read the wire shape. No case binds a
socket.
