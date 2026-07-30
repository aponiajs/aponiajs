# Descriptors

The same framework with no decorators anywhere. `defineModule`, `provideValue`,
`provideClass`, and `elysiaController` build the frozen descriptors the runtime
consumes. The concise controller callback uses native Elysia inference without
an options object, `as const`, a manual context annotation, or `typeof`.

The example also throws `httpErrors.notFound(...)` and verifies the resulting
RFC 9457 Problem Details response.

## Run

```bash
bun run example:descriptors
```

## Test

```bash
bun run --cwd examples/descriptors test
```

`test/descriptors.e2e-spec.ts` asserts the served route, singleton identity,
frozen results, the default Problem Details response, and the
`INVALID_CONTROLLER` failure when a controller factory returns something that
is not an Elysia instance.

[Every example](../README.md)
