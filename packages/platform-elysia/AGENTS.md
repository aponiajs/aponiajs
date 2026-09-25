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
| `inspection/`  | Read-only projection of a compiled application for build-time consumers       |
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
- `routing/native-route.ts` is the only module that calls Elysia's route
  registration API. A version that moves it fails there as
  `UNSUPPORTED_ELYSIA_VERSION` instead of as a bare `TypeError` from inside a
  compiled dependency. Do not call `.route()` anywhere else.
- `modules/route-uniqueness.ts` rejects a route two different declarations
  claim, raising `DUPLICATE_ROUTE` from `compileRootModule` with the method,
  path, both modules, both controllers, and both handler keys. Elysia would
  otherwise resolve a repeated `(method, path)` by whichever registration wins
  under `elysia.aot`, so the answering handler would follow a compiler flag.
  The check reasons over the modules reachable from the compiled root by
  `imports` — the set `compileModuleGraph` mounts — because the module
  compiler's working maps also hold definitions the root never reaches. One
  `(controller, handler)` declaration reached through two of those modules, as
  a dynamic module merged onto a decorated class produces, repeats one route
  rather than claiming it twice, and stays supported. Routes a native plugin
  provides stay outside the check: plugins mount through `use()`, and a
  controller overriding one is Elysia's documented behavior. A low-level
  controller descriptor builds its routes in a callback that needs an instance,
  so it carries no route plan and, like inspection, contributes nothing to the
  check. `compileRootModule` is where the check lives so
  `inspectAponiaApplication`, which lowers through it, raises the same code for
  the same application.
- Route parameter binding is compiled once while the controller is mounted.
  Generated invokers must expose each used context field directly and call the
  controller with `handler.call(instance, ...)`. A route keeps the synchronous
  invoker only when the handler's own function kind or its emitted
  `design:returntype` metadata proves a synchronous return; nothing else can
  prove one, so every other route is compiled Promise-capable, which costs at
  most one already-settled `await` per request. The handler source is never
  consulted: a Promise returned without a call expression
  (`return this.pendingLookup`) leaves no trace to match, and a synchronous
  invoker runs `onAfterHandle` before Elysia awaits that Promise, exposing the
  raw Promise to the lifecycle. Elysia compiles handlers by statically reading
  their source (sucrose): `Reflect.apply` hides required fields, while
  forwarding context through a generic mapper makes Elysia materialize every
  optional field on every request.
- `AponiaApplicationOptions.invokers` substitutes build-time generated invokers
  for the platform's own compilation. It is keyed by controller class token, and
  each factory builds a map keyed by handler property key once the container has
  created the controller instance. A controller without an entry, a property key
  missing from a supplied map, and a symbol-keyed handler all fall back to
  compiled binding, and an entry for a token no controller uses is ignored. The
  option is never mutated.
- `registerCompiledElysiaRoutes` rejects a route handler that is a class
  constructor with `INVALID_CONTROLLER` while the controller mounts. A class
  passes the callable check and then throws a raw engine message on every
  request, so the guard must run before an invoker is selected for that route.
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
- `inspectAponiaApplication` is a projection, never a second compiler. It runs
  bootstrap's own lowering (`compileRootModule`, then `createContainer`, then
  `compileElysiaWebSocketGateways`) and reads the resulting descriptors, so it
  constructs no provider and no controller instance and raises the same
  `AponiaError` codes bootstrap raises for the same application. Give it new
  data by reading a descriptor, never by re-deriving compilation.
- Inspection output is plain, deeply frozen, and JSON-serializable: no
  validator, function, class instance, or raw symbol may reach it. Symbol
  module identities and symbol handler property keys are projected with
  `String(symbol)`, which keeps the `Symbol(description)` marker readable.
- Inspection ordering is part of the contract. Modules keep graph order,
  providers and gateway events keep declaration order, routes sort by path,
  method, controller, handler, and module, and gateways sort by canonical path.
  Comparisons stay code-unit based so every runtime orders identically.
- A controller mounted through the low-level descriptor path builds its routes
  in a callback that needs an instance, so it is listed in its module's
  `controllers` and contributes no `routes` entry. Controllers bootstrap would
  refuse still fail inspection with `UNSUPPORTED_CONTROLLER`.
- Inspection reads each provider's dependencies through `providerDependencies`
  from `@aponiajs/core`, the same function the container resolves through. Never
  restate that switch here; a new provider kind must land in one place.

## Elysia version compatibility

The peer range is `^1.4.29`; every workspace manifest must declare the same
range. Two ranges that disagree make Bun install two copies, and a controller
typed against one is not assignable to the other.

Elysia 2 is a prerelease on the `next` dist-tag and is not supported. Its
incompatibilities were verified by running `2.0.0-beta.19`, not by reading the
release notes, because the published docs are still 1.x:

| Call site                                                                     | Elysia 2                                                                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `routing/native-route.ts`                                                     | `route(...)` removed; `method(method, path, hook, handler)` swaps the last two arguments |
| `routing/route-compiler.ts` (`TSchema`)                                       | no longer root-exported; import from `typebox`                                           |
| `routing/route-context.types.ts` (`SingletonBase`)                            | no longer root-exported; import from `elysia/types`                                      |
| `routing/route-context.types.ts` (`~Singleton`/`~Ephemeral` `resolve` keys)   | `resolve` removed; its timing folded into `derive`                                       |
| `errors/http-error.ts` and `errors/http-error.types.ts` (`InvertedStatusMap`) | renamed to `StatusMapBack`                                                               |

`docs/elysia-compatibility.md` is the user-facing half of this. Update both
together, and re-verify against a real install rather than the blog post.

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

Inspection behavior belongs in `tests/inspection.test.ts`, mirrored in
`tests-vp/inspection.conformance.ts`. Cover shapes, ordering, frozen-ness,
serialization, and the `AponiaError` codes inspection shares with bootstrap;
assert on codes, never on message text.
