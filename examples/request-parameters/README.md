# Request parameters

Request parameter decorators for validated input, cookies, the native request,
mutable response settings, the typed status helper, and the whole Elysia
context. The example includes both Nest-style `@Res()` and native-named
`@Set()`/`@Status()` usage, plus a handler that receives the context without a
decorator.

## Run

```bash
bun run example:request-parameters
```

## Test

```bash
bun run --cwd examples/request-parameters test
```

`test/request-parameters.e2e-spec.ts` asserts each decorator, including what an absent value produces.

[Every example](../README.md)
