# Elysia Compatibility

AponiaJS lowers your controllers into native Elysia routes and mounts them on an
Elysia application you keep full access to. The Elysia version an application
installs is therefore part of the framework contract rather than an internal
detail.

## Supported version

`@aponiajs/platform-elysia` declares the range it supports as a peer dependency:

```json
"peerDependencies": {
  "elysia": "^1.4.29"
}
```

Install any Elysia 1.4.x release. The examples, the generator template, and this
repository all pin `^1.4.30`, the newest patch.

## When the installed version is wrong

A pair that does not match fails during bootstrap, before the application
listens. The failure is an `AponiaError` with the code
`UNSUPPORTED_ELYSIA_VERSION`, raised while the first route mounts, and it names
the route that could not be registered.

```text
AponiaError: The installed Elysia does not expose route(), so "GET /health" cannot be mounted.
AponiaJS supports Elysia 1.4.x, where routes are registered with
route(method, path, handler, hook). Elysia 2 replaced it with
method(method, path, hook, handler) and is not supported yet.
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
"elysia": "^1.4.30"
```

## What changes in Elysia 2

Elysia 2 is published on the `next` dist-tag as a prerelease and is not
supported yet. Its route registration API is incompatible at the call site:

| Area                | Elysia 1.4                               | Elysia 2                              |
| ------------------- | ---------------------------------------- | ------------------------------------- |
| Route registration  | `route(method, path, handler, hook)`     | `method(method, path, hook, handler)` |
| Type re-exports     | `TSchema`, `SingletonBase` from the root | moved to `elysia/types` or `typebox`  |
| Status helper types | `InvertedStatusMap`                      | `StatusMapBack`                       |
| `context.set`       | `redirect` is accepted                   | removed in favour of `redirect(url)`  |
| Plugin `resolve`    | separate hook on its own timing          | removed; `derive` takes its timing    |

AponiaJS pins its peer range to 1.4.x so a mismatched pair fails loudly instead
of mounting routes that silently lose validation or context values.

## Native escape hatches

`configureNative` receives the Elysia instance during bootstrap, and
`elysiaController` hands you the application to register routes yourself. Those
callbacks run on your Elysia version directly, so the rules above apply to them
too — AponiaJS cannot translate an API it does not call.

See [`native-plugins.md`](native-plugins.md) for mounting a plugin, and
[`eden-treaty.md`](eden-treaty.md) for the typed client built on the same
instance.
