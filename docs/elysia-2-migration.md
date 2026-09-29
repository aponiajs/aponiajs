# Migrating to Elysia 2 beta

AponiaJS pins `elysia@2.0.0-beta.19` in its peer dependency, examples, and
generated starter. Install the same version alongside AponiaJS. The TypeBox
schema compiler uses `typebox@1.3.0`; a newer TypeBox release may change the
validation and numeric coercion behavior of this beta.

## Native code changes

- Register native routes with `method(method, path, hook, handler)`. Native
  `.get(path, hook, handler)` and `.post(path, hook, handler)` take the hook
  before the handler as well. AponiaJS controller decorators keep their own
  signatures.
- Use Elysia 2 lifecycle methods (`request`, `beforeHandle`, `afterHandle`,
  `afterResponse`, `error`, `setup`). Read `responseValue` in `afterHandle`.
- Use `StatusMapBack` and `ElysiaStatus`; import TypeBox schemas from `typebox`
  and `SingletonBase` from `elysia/types` when writing native types.
- Return `redirect(url)` instead of assigning `context.set.redirect`. Replace
  plugin `resolve` with `derive` where its request timing fits.
- Elysia 2's `precompile` option is a boolean. The former `aot` option and
  granular precompile object are no longer supported. AponiaJS enables
  `normalize: "typebox"` on its root application so `t.Numeric()` can decode
  path and query values under the pinned TypeBox release.
- Invalid **response** bodies now result in HTTP 500; invalid **request** bodies
  still result in HTTP 422. Elysia's native validation response uses
  `application/problem+json`.

Routes registered through `registerRoutes` or `buildPlugin` remain native Elysia
routes and do not receive AponiaJS guards, interceptors, or exception filters.
The platform's compiled routes carry the default Problem Details mapping for
unhandled errors, including when `precompile` is disabled.

See [Elysia compatibility](elysia-compatibility.md) for the version contract.
