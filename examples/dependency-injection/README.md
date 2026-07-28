# Dependency injection

Every provider kind in one module: `provideValue`, `provideFactory`, `provideClass`, and `provideAlias`, with tokens naming what is not a class. One provider is deliberately left out of `exports` to show that a private provider stays invisible to importers.

## Run

```bash
bun run example:dependency-injection
```

## Test

```bash
bun run --cwd examples/dependency-injection test
```

`test/providers.e2e-spec.ts` asserts what each provider resolved to. `test/module-visibility.e2e-spec.ts` asserts the failures a wrong graph raises: `MISSING_PROVIDER`, `MODULE_CYCLE`, `AMBIGUOUS_PROVIDER`, and `INVALID_EXPORT`.

[Every example](../README.md)
