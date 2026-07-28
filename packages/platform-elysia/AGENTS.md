# @aponiajs/platform-elysia — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The Elysia adapter: it lowers decorated classes into descriptors, bootstraps the
application, maps routes, and mounts native plugins. It depends on `common` and
`core`, with `elysia` as a peer.

| File                  | Owns                                                                           |
| --------------------- | ------------------------------------------------------------------------------ |
| `decorated-module.ts` | `compileRootModule`, route mapping, `toRouteHook`, `bindParameters`            |
| `application.ts`      | `AponiaFactory.create`, `AponiaElysiaApplication`, bootstrap order and logging |
| `plugin-module.ts`    | `ElysiaPluginModule.register`/`registerAsync`, `defineElysiaPlugin`            |
| `route-context.ts`    | `ElysiaRouteContext`, `ElysiaPluginTypes`, `ElysiaInputSchema`                 |
| `controller.ts`       | `defineElysiaController`, `ELYSIA_CONTROLLER`                                  |

## Invariants

- Bootstrap order is load-bearing: logger, compile and create the container,
  create the root Elysia named after the root module id, first pass mounting
  plugin modules and eagerly instantiating providers, second pass mounting
  controllers, then await `nativeApplication.modules`. `configureNative` must
  return the instance it receives.
- A route handler must receive the context as a **direct call argument**, as in
  `handler.call(instance, ...bindParameters(parameters, context))`. Elysia
  compiles handlers by statically reading their source (sucrose), so hiding the
  context behind `Reflect.apply(handler, instance, [context])` makes Elysia skip
  building parts of the context and `set.headers` silently stops working.
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
- Verify a controller's `buildPlugin` result is a real `Elysia` instance and
  raise `INVALID_CONTROLLER` when it is not.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/platform.conformance.ts` under Vite+.
Prefer building an application with `AponiaFactory.create` and asserting through
`application.handle(new Request(...))`.

`tests/plugin-context.test.ts` and `tests/plugin-definition.test.ts` hold
compile-time assertions beside their runtime cases; they fail `bun run check`
when a plugin type is lost or widened. Keep both lanes in step when the context
mapping changes, and document behavior in
[`docs/native-plugins.md`](../../docs/native-plugins.md).
