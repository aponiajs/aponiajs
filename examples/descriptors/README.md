# Descriptors

The same framework with no decorators anywhere. `defineModule`, `provideValue`,
`provideClass`, and `defineElysiaController` build the frozen descriptors the
runtime consumes — the API a tool or build-time source emitter would target.
The controller uses `registerRoutes` to write directly to the root Elysia
application without constructing an intermediate plugin.

## Run

```bash
bun run example:descriptors
```

## Test

```bash
bun run --cwd examples/descriptors test
```

`test/descriptors.e2e-spec.ts` asserts the served route, singleton identity, frozen results, and the `INVALID_CONTROLLER` failure when a controller factory returns something that is not an Elysia instance.

[Every example](../README.md)
