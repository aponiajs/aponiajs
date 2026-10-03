# Elysia Compatibility

AponiaJS lowers your controllers into native Elysia routes and mounts them on an
Elysia application you keep full access to. The Elysia version an application
installs is therefore part of the framework contract rather than an internal
detail.

## Supported version

`@aponiajs/platform-elysia` declares the version it supports as a peer
dependency, and it is an exact pin rather than a range:

```json
"peerDependencies": {
  "elysia": "2.0.0-beta.19",
  "typebox": "^1.3.0"
}
```

Every workspace manifest, every example, and the generator template declares
that same pin.

The Elysia pin is exact on purpose, because a caret over a prerelease does not
mean what it looks like. `^2.0.0-beta.19` also matches `2.0.0-exp.64`: semver
compares prerelease identifiers as strings, `exp` sorts above `beta`, and an
identifier is compared only when the version core matches, so the caret would
accept an Elysia experiment release. The exact pin is what keeps an installed
tree on the release this framework was verified against.

`typebox` is a peer because Elysia 2 declares it as one and no longer
re-exports `TSchema` from its root. A caret range has no prerelease hazard here,
so it carries one. An application that types a schema writes `TSchema` from
`typebox` directly.

## When the installed version is wrong

A pair that does not match fails during bootstrap, before the application
listens. The failure is an `AponiaError` with the code
`UNSUPPORTED_ELYSIA_VERSION`, raised while the first route mounts, and it names
the route that could not be registered.

```text
AponiaError: The installed Elysia does not expose method(), so "GET /health" cannot be mounted.
AponiaJS supports Elysia 2.0.x, where routes are registered with
method(method, path, hook, handler). Elysia 1.4 registers them with
route(method, path, handler, hook) and is no longer supported.
```

Nothing is registered on a partially mounted application: the error aborts
bootstrap before `listen()` can succeed.

## Keeping one Elysia in a workspace

Bun resolves every manifest that depends on Elysia independently. Two ranges
that disagree install two copies, and a controller typed against one copy is
not assignable to the other — which surfaces as type errors in your own
application rather than a version warning.

Declare one range across the whole workspace, including example and fixture
packages:

```json
"elysia": "2.0.0-beta.19"
```

## Migrating from Elysia 1.4

Elysia 2 is the supported release. AponiaJS registers every route itself, so a
controller written with AponiaJS decorators does not change; what follows is
what to know when you reach for Elysia directly — through `configureNative`, an
`controller(...)` callback, or a native plugin.

| Area               | Elysia 1.4                                                            | Elysia 2                                       |
| ------------------ | --------------------------------------------------------------------- | ---------------------------------------------- |
| Route registration | `route(method, path, handler, hook)`                                  | `method(method, path, hook, handler)`          |
| Type re-exports    | `TSchema` from the root                                               | `TSchema` from `typebox`                       |
| Type re-exports    | `SingletonBase`, `ElysiaConfig`, `MergeElysiaInstances`, `EventScope` | from `elysia/types`                            |
| WebSocket type     | `ElysiaWS<Context, Route>`                                            | `ElysiaWS<Route>` in `elysia/ws`               |
| HTTP status types  | `InvertedStatusMap`                                                   | `StatusMapBack`                                |
| HTTP status types  | `ElysiaCustomStatusResponse`                                          | `ResponseStatus`                               |
| Schema union       | `AnySchema`                                                           | `TypeBoxSchema \| StandardSchemaV1Like`        |
| `ElysiaConfig`     | carries `aot`                                                         | no `aot`; needs at least two type arguments    |
| Instance config    | `app.config`                                                          | gone                                           |
| Plugin hook        | `resolve` on its own timing                                           | removed; `derive` takes its timing             |
| `context.set`      | `redirect` is accepted                                                | removed in favour of returning `redirect(url)` |

Handing Elysia a hook before the handler in the old order is refused at run
time, with `[Elysia] .get('/x', handler, hook) is the 1.x order; Elysia 2 takes
(path, hook, handler) — see the 2.0 migration guide`.

AponiaJS's own route registration lives in `routing/native-route.ts`, the only
module that calls that native API, so a moved signature fails there as
`UNSUPPORTED_ELYSIA_VERSION` instead of as a bare `TypeError` from inside a
compiled dependency.

## Native escape hatches

`configureNative` receives the Elysia instance during bootstrap, and
`controller` hands you the application to register routes yourself. Those
callbacks run on your Elysia version directly, so the rules above apply to them
too — AponiaJS cannot translate an API it does not call.

See [`native-plugins.md`](native-plugins.md) for mounting a plugin, and
[`eden-treaty.md`](eden-treaty.md) for the typed client built on the same
instance.
