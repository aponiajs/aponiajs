# Lifecycle

A provider announces its own start and stop with two methods. Nothing registers them, no decorator
marks them, and the same class registered by a hand-written descriptor carries them unchanged,
because the framework reads the method from the instance.

## Run

```bash
bun run example:lifecycle
```

## Test

```bash
bun run --cwd examples/lifecycle test
```

`test/lifecycle.e2e-spec.ts` reads the provider's state through a route before closing, then closes
the application and asserts the stop hook ran and in which order — the one moment a route cannot
report, because by then the application is closed.

[Every example](../README.md)
