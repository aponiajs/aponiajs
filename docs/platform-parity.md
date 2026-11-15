# Platform Parity

`@aponiajs/platform-elysia`, `@aponiajs/platform-hono`, `@aponiajs/platform-h3`,
and `@aponiajs/platform-nitro` boot the same graph and run the same request
pipeline from `@aponiajs/platform-core`. This page states where they agree, where
they differ, and what a platform refuses.

## The same on every platform

| Contract            | What it means                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module graph and DI | Providers, controllers, imports, exports, cycles, and scopes come from the same compiler and container.                                                   |
| Route lowering      | `@Controller`, HTTP method decorators, `@All`, the route prefix, and `@Version` produce the same paths.                                                   |
| Validation          | Standard Schema and TypeBox validators run for body, query, params, headers, cookie, and response slots; a refusal is `422` with code `VALIDATION_ERROR`. |
| Enhancers           | Guards, interceptors, exception filters, and pipes run in the documented order.                                                                           |
| Middleware          | `AponiaMiddleware` targets and exclusions run before the guards.                                                                                          |
| Responses           | `@Header`, `@HttpCode`, `@Serialize`, `@Render`, `@Sse`, and `@Deprecated` keep their contract.                                                           |
| Errors              | `HttpError` answers RFC 9457 `application/problem+json`; an unhandled failure is a `500` problem document that never carries a stack or cause.            |
| Lifecycle           | `onModuleInit`, `onApplicationBootstrap`, and the shutdown passes run in the same order.                                                                  |
| Inspection          | `inspectAponiaApplication` projects the same graph.                                                                                                       |
| Health              | Readiness and liveness probes mount on the platform's own route table.                                                                                    |

## Deliberate differences

| Area                   | Elysia                                                                                             | Hono, H3, Nitro                                                                                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native plugins         | `PluginModule` and `AponiaApplicationOptions.plugins` mount Elysia plugins.                        | Not carried. A graph that imports a plugin module is still lowered; the plugin itself is Elysia's.                                                                                                                                                                                      |
| Context typing         | `HandlerContext` merges the plugins an application mounted, and Eden Treaty reads the route types. | No plugin-typed context and no Eden types; `PlatformRouteContext` states the request fields.                                                                                                                                                                                            |
| Validation execution   | Elysia runs the validator and answers its own `422` body.                                          | The kernel runs Standard Schema through `~standard.validate` and TypeBox through `typebox/value`; a `422` carries `code: "VALIDATION_ERROR"` and an `errors` list.                                                                                                                      |
| Response serialization | Elysia's serializer applies its rules.                                                             | Strings are text, bytes and streams pass through, every other value is JSON.                                                                                                                                                                                                            |
| `@Ip()`                | Read from the Elysia server handle.                                                                | Read from the host: Hono through its Bun adapter, H3 through `getRequestIP`, and `undefined` when the host states none.                                                                                                                                                                 |
| WebSockets             | `application.ws()` with the `elysia/websocket` capability.                                         | Hono upgrades through `hono/bun`; H3 upgrades through `crossws` on the H3 route and the Bun listener; Nitro upgrades the H3 route through its own crossws server. `client.emit` answers one client and `server.emit` broadcasts, as in Nest; the wire format is `{ event, data }` JSON. |
| Listener               | Elysia's adapter.                                                                                  | Bun's server. No Node listener is provided.                                                                                                                                                                                                                                             |
| Native route detail    | `@Deprecated()` sets Elysia route detail.                                                          | The headers are applied; there is no route table to annotate.                                                                                                                                                                                                                           |
| First-party modules    | Every package in this repository.                                                                  | Modules that wrap Elysia plugins (`@aponiajs/cors`, `security`, `openapi`, `devtools`, `graphql`, `metrics`, `mcp`) stay Elysia-only. Modules that only need the container and the error contract run anywhere.                                                                         |

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
bun test packages/platform-nitro
bun run test:vite-plus
```

The conformance lane runs on Node and never calls `listen`; the Bun lane boots
each platform and answers real requests through it.
