# Platform Parity

`@aponiajs/platform-elysia`, `@aponiajs/platform-hono`, and
`@aponiajs/platform-h3` keep one authoring contract. Each platform keeps its own
runtime internals: Elysia registers native routes and hooks, Hono registers on
its own router, and H3 on its own router. Nitro is a delivery adapter over an
application booted on a platform, not a peer platform: it owns the server and
forwards each request to `application.handle`.
What they share is the compiled descriptor, the request contract (validation,
parameter binding, enhancer order, pipes, filters, version negotiation), the
lifecycle, and the shared route handler in `@aponiajs/platform-core` that every
platform calls from the route its runtime matched. This page states where they
agree, where they differ, and what a platform refuses.

The three platforms are independent. Each depends on `@aponiajs/common`,
`@aponiajs/core`, `@aponiajs/platform-core`, and its own runtime peer, and no
platform depends on another. `scripts/platform-independence.spec.ts` enforces
that, and `packages/platform-core/tests/support/platform-contract.ts` runs the
same behavioral cases on every platform in both test lanes.

## The same on every platform

| Contract            | What it means                                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module graph and DI | Providers, controllers, imports, exports, cycles, and scopes come from the same compiler and container.                                                                                                                                         |
| Route lowering      | `@Controller`, HTTP method decorators, `@All`, the route prefix, and `@Version` produce the same paths.                                                                                                                                         |
| Validation          | Standard Schema and TypeBox validators run for body, query, params, headers, cookie, and response slots; the shared route handler answers a refusal with `422` and code `VALIDATION_ERROR`, and Elysia answers its own `422` body (see deltas). |
| Enhancers           | Guards, interceptors, exception filters, and pipes run in the documented order.                                                                                                                                                                 |
| Middleware          | `AponiaMiddleware` targets and exclusions run before the guards.                                                                                                                                                                                |
| Responses           | `@Header`, `@HttpCode`, `@Serialize`, `@Render`, `@Sse`, and `@Deprecated` keep their contract.                                                                                                                                                 |
| Errors              | `HttpError` answers RFC 9457 `application/problem+json`; an unhandled failure is a `500` problem document that never carries a stack or cause.                                                                                                  |
| Lifecycle           | `onModuleInit`, `onApplicationBootstrap`, and the three stopping hooks run in the same order on every platform: `beforeApplicationShutdown`, the listener stop, `onModuleDestroy` reversed, `onApplicationShutdown`.                            |
| Version negotiation | The `versioning` option compiles one table from the booted routes; `header` and `media-type` rewrite a request to its `/vN` mount before routing.                                                                                               |
| Health probes       | `{ health: true }` mounts readiness and liveness on the platform's own route table; readiness answers `503` from the moment `close()` begins, and a probe path a controller claims is refused with `DUPLICATE_ROUTE`.                           |
| Static assets       | `staticAssets` serves the same directories with the same path rule, refusal, and headers on every platform; only opening the file is the runtime's.                                                                                             |
| Plugins             | `providePlatformModule` states a package's `platforms` and its per-platform `adapters`; the boot refuses an undeclared platform with `UNSUPPORTED_PLATFORM_FEATURE` before mounting anything, then runs the adapter the platform names.         |

## Deliberate differences

| Area                    | Elysia                                                                                             | Hono and H3                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native plugins          | `PluginModule`, `definePlugin`, and `AponiaApplicationOptions.plugins` mount Elysia plugins.       | A package states `platforms` and `adapters` through `@aponiajs/platform-core`'s `providePlatformModule`; the boot selects `adapters[platform]` and runs it on the runtime's own application before middleware and routes.                                                                                                                                                                                                         |
| Context typing          | `HandlerContext` merges the plugins an application mounted, and Eden Treaty reads the route types. | No plugin-typed context and no Eden types; `PlatformRouteContext` states the request fields. The platform-neutral typed client is a planned package built from a generated route map.                                                                                                                                                                                                                                             |
| Validation execution    | Elysia runs the validator and answers its own `422` body.                                          | The shared route handler runs Standard Schema through `~standard.validate` and TypeBox through `typebox/value`; a `422` carries `code: "VALIDATION_ERROR"` and an `errors` list.                                                                                                                                                                                                                                                  |
| Response serialization  | Elysia's serializer applies its rules.                                                             | Strings are text, bytes and streams pass through, every other value is JSON.                                                                                                                                                                                                                                                                                                                                                      |
| `@Ip()`                 | Read from the Elysia server handle.                                                                | Read from the host: Hono through its Bun adapter, H3 through `getRequestIP`, and `undefined` when the host states none.                                                                                                                                                                                                                                                                                                           |
| WebSockets              | `application.ws()` with the `elysia/websocket` capability.                                         | Hono upgrades through `hono/bun`; H3 upgrades through `crossws` on the H3 route and the Bun listener. `client.emit` answers one client and `server.emit` broadcasts, as in Nest; the wire format is `{ event, data }` JSON.                                                                                                                                                                                                       |
| Gateway handler surface | `@ConnectedSocket()` is the native `ElysiaWS`; a result is emitted under the subscribed event.     | `client.emit(event, data)` answers one client and `server.emit(event, data)` broadcasts; the wire is `{ event, data }` JSON.                                                                                                                                                                                                                                                                                                      |
| Listener                | Elysia's adapter.                                                                                  | Bun's server. No Node listener is provided.                                                                                                                                                                                                                                                                                                                                                                                       |
| Native route detail     | `@Deprecated()` sets Elysia route detail.                                                          | `Deprecation`, `Sunset`, and `Link` headers are applied to every answer, a guard refusal included; there is no route table to annotate.                                                                                                                                                                                                                                                                                           |
| Inspection              | `inspectAponiaApplication` projects the compiled graph.                                            | Not exported by the platform package; the projection lives in `@aponiajs/platform-elysia` and reads the same decorated module classes.                                                                                                                                                                                                                                                                                            |
| First-party modules     | Every package in this repository.                                                                  | Modules that wrap Elysia plugins today (`cors`, `security`, `session`, `compression`, `idempotency`, `metrics`, `openapi`, `graphql`, `opentelemetry`, `devtools`, `testing`) declare `platforms: ["elysia"]` through the standard registration, so a boot on another platform refuses with `UNSUPPORTED_PLATFORM_FEATURE` instead of mounting nothing. Modules that only need the container and the error contract run anywhere. |

### WebSocket deltas

The authoring decorators, the `{ event, data }` wire format, the `exception`
frame, duplicate-path and duplicate-event refusals, `client.emit`/
`server.emit`, per-message payload-limit enforcement, payload schema validation,
gateway filters, and generator streaming are shared on every platform. These
gateway features remain the Elysia platform's:

| Feature                                                   | Elysia                                                          | Hono and H3                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Handshake guards                                          | Run before the upgrade; a refusal is `403` and no socket opens. | Run when the socket opens; a refusal closes it with `1008`.                                 |
| `origins`                                                 | Applied by the native server.                                   | The host refuses an origin list it cannot enforce.                                          |
| `maxPayloadLength`, `idleTimeoutMs`, `sendPings` (server) | Applied per gateway by the native server.                       | Merged server-wide onto the Bun listener; a host that owns its server keeps its own policy. |
| `application.close()`                                     | Closes active connections by default.                           | Defaults to `false`; the host's listener decides how connections stop.                      |

## What a platform refuses

- A graph that declares a WebSocket gateway on a host whose runtime states no
  gateway support fails the boot with `UNSUPPORTED_PLATFORM_FEATURE` and names
  the platform, the gateway, and its path. It never mounts a route that cannot
  upgrade. Every shipped platform states support; a custom host that does not is
  refused.
- Two gateways on one path fail with `DUPLICATE_WEBSOCKET_GATEWAY`; two
  gateways answering one event fail with `DUPLICATE_WEBSOCKET_HANDLER`.
- An application-level enhancer the root module cannot reach fails the boot with
  `MISSING_PROVIDER`, the same as on Elysia.

## Verifying a platform

```bash
bun test packages/platform-core
bun test packages/platform-hono
bun test packages/platform-h3
bun test packages/platform-elysia
bun run test:vite-plus
```

The conformance lane runs on Node and never calls `listen`; the Bun lane boots
each platform and answers real requests through it. Both lanes run the shared
contract in `packages/platform-core/tests/support/platform-contract.ts`.
