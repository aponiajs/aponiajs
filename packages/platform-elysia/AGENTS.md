# @aponiajs/platform-elysia — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The Elysia adapter: it lowers decorated classes into descriptors, bootstraps the
application, maps HTTP routes and WebSocket gateways, and mounts native plugins.
It depends on `common` and `core`, with `elysia` as a peer.

| Domain         | Owns                                                                          |
| -------------- | ----------------------------------------------------------------------------- |
| `application/` | Factory orchestration, application lifecycle wrapper, public option contracts |
| `modules/`     | `compileRootModule` and decorator-to-descriptor lowering                      |
| `controllers/` | Controller descriptors, direct registration, `ELYSIA_CONTROLLER`              |
| `errors/`      | Typed HTTP errors and RFC 9457 Problem Details responses                      |
| `plugins/`     | Native plugin module registration and plugin contracts                        |
| `routing/`     | Route plans, compiled invokers, schemas, and native context types             |
| `websockets/`  | Provider discovery, gateway plans, message dispatch, and native socket types  |

`src/index.ts` is the only public barrel. Keep `*.types.ts` colocated with the
runtime boundary it describes.

## Invariants

- Bootstrap order is load-bearing: logger, compile and create the container,
  create the root Elysia named after the root module id with its explicit
  compilation policy, first pass mounting plugin modules and eagerly
  instantiating providers, controller mounting, await native plugin composition,
  WebSocket gateway registration and initialization, then await
  `nativeApplication.modules` again.
  `configureNative` must return the instance it receives.
- Decorated controllers register their compiled route plans directly on the
  root Elysia instance. Low-level controller descriptors retain `buildPlugin`
  as their compatibility and escape-hatch path.
- Route parameter binding is compiled once while the controller is mounted.
  Generated invokers must expose each used context field directly and call the
  controller with `handler.call(instance, ...)`. Synchronous handlers must not
  be promoted to Elysia's async composition path; declared or inferred Promise
  handlers must remain awaited. Elysia compiles handlers by statically reading
  their source (sucrose): `Reflect.apply` hides required fields, while
  forwarding context through a generic mapper makes Elysia materialize every
  optional field on every request.
- `toElysiaSchema` is the single boundary where a `NativeSchema` is restored to
  a TypeBox `TSchema`. Cookie validators and every member of a status-specific
  response map pass through that boundary. Nothing else in the workspace may
  assume TypeBox.
- Decorated modules, controllers, and `@Validation()` model classes are the
  normal application path. Resolve each validation model once inside route
  registration, pass its exact raw validator to Elysia, and keep direct
  validators plus native controller registration as escape hatches. Never add
  model reflection or validation work to the request hot path.
- `ElysiaRouteContext` and `ElysiaStatus` lower model classes through a type-only
  Standard Schema projection. Keep that projection aligned with runtime route
  lowering, including status-specific response maps; it must never read model
  metadata or construct validators.
- A direct `registerRoutes` callback may return its fluent Elysia chain to
  preserve the route contract for Eden, or return `void` for compatibility. It
  must never return a different Elysia instance.
- `elysiaController` is the concise direct-registration facade. Its callback is
  the native escape hatch when Elysia inference is more useful than decorator
  metadata; `defineElysiaController` remains the advanced descriptor API.
- `HttpError` serializes application failures as RFC 9457 Problem Details. Its
  response never includes its stack or cause, and the `httpErrors` factory set
  must cover every 4xx and 5xx status exported by the supported Elysia version.
- `ElysiaRouteContext` merges plugin types the way Elysia's own `.use()` does:
  `~Singleton` for `decorator`, `store`, `derive`, and `resolve`, plus
  `~Ephemeral` derives and resolves. `~Volatile` stays excluded because a
  plugin-local derive never reaches a controller mounted beside the plugin.
  Runtime and type must move together.
- The first type argument accepts either a schema or the plugins. An
  all-optional `InputSchema` also matches an Elysia instance, so the conditional
  tests the plugin shape first.
- `defineElysiaPlugin` exposes the plugin on a real `plugin` property, never a
  phantom type, so the value is inspectable at runtime.
- Verify a fallback controller's `buildPlugin` result is a real `Elysia`
  instance and raise `INVALID_CONTROLLER` when it is not.
- A gateway is a decorated class provider. Discover metadata on `useClass`,
  resolve the existing provider token through `resolveModuleProvider`, and
  never construct a second instance.
- Canonical gateway paths and message events are unique before routes mount.
  One gateway maps to one native `application.ws()` route. A collision with a
  configured or plugin-provided native WS route must fail deterministically.
- Compile `@MessageBody()` and `@ConnectedSocket()` arguments during bootstrap.
  Preserve `undefined` as no response and every other value as data;
  `WsResponse`, Promise, generator, and async-generator results retain their
  documented behavior.
- WebSocket exception frames expose only a stable code and safe message.
  `@WebSocketServer()` receives the root Elysia application before
  `afterInit`; connection and disconnection lifecycle return values are never
  sent to clients.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+.
Prefer building an application with `AponiaFactory.create` and asserting through
`application.handle(new Request(...))`.

`tests/plugin-context.test.ts` and `tests/plugin-definition.test.ts` hold
compile-time assertions beside their runtime cases; they fail `bun run check`
when a plugin type is lost or widened. Keep both lanes in step when the context
mapping changes, and document behavior in
[`docs/native-plugins.md`](../../docs/native-plugins.md).

WebSocket behavior belongs in `tests/websocket-gateway.test.ts`, with the public
contract mirrored in `tests-vp/websocket-gateway.conformance.ts` and a real
socket path in `examples/websockets/`.
