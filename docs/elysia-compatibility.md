# Elysia compatibility

AponiaJS lowers controller plans into native Elysia routes. The currently
supported peer dependency is **`elysia@2.0.0-beta.19`**, pinned exactly in the
workspace, examples, and generated application. Use **`typebox@1.3.0`** with
this beta for native TypeBox validation and numeric coercion. Bun resolves
workspace dependencies independently, so keep these versions aligned in every
application package.

The adapter registers routes through Elysia 2's
`method(method, path, hook, handler)` API. `configureNative` and
`elysiaController` receive the native instance and must use its installed API
directly. When neither native registration method is callable, bootstrap raises
`AponiaError` with `UNSUPPORTED_ELYSIA_VERSION` and structured route details.

For native API and response behavior changes, see the
[Elysia 2 migration guide](elysia-2-migration.md). The
[native plugins guide](native-plugins.md) covers direct Elysia registration,
and [Eden Treaty](eden-treaty.md) covers clients for the same instance.
