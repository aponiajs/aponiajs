# @aponiajs/platform-elysia — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The Elysia adapter: it lowers decorated classes into descriptors, bootstraps the
application, maps routes, and mounts native plugins. It depends on `common` and
`core`, with `elysia` as a peer.

| Domain         | Owns                                                                          |
| -------------- | ----------------------------------------------------------------------------- |
| `application/` | Factory orchestration, application lifecycle wrapper, public option contracts |
| `modules/`     | `compileRootModule` and decorator-to-descriptor lowering                      |
| `controllers/` | Controller descriptors, direct registration, `ELYSIA_CONTROLLER`              |
| `plugins/`     | Native plugin module registration and plugin contracts                        |
| `routing/`     | Route plans, compiled invokers, schemas, and native context types             |

`src/index.ts` is the only public barrel. Keep `*.types.ts` colocated with the
runtime boundary it describes.

## Invariants

- Bootstrap order is load-bearing: logger, compile and create the container,
  create the root Elysia named after the root module id with its explicit
  compilation policy, first pass mounting plugin modules and eagerly
  instantiating providers, second pass mounting controllers, then await
  `nativeApplication.modules`. `configureNative` must return the instance it
  receives.
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
  a TypeBox `TSchema`. Nothing else in the workspace may assume TypeBox.
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

## Tests

`tests/*.test.ts` under Bun, `tests-vp/platform.conformance.ts` under Vite+.
Prefer building an application with `AponiaFactory.create` and asserting through
`application.handle(new Request(...))`.

`tests/plugin-context.test.ts` and `tests/plugin-definition.test.ts` hold
compile-time assertions beside their runtime cases; they fail `bun run check`
when a plugin type is lost or widened. Keep both lanes in step when the context
mapping changes, and document behavior in
[`docs/native-plugins.md`](../../docs/native-plugins.md).
