# Native plugins

Native Elysia plugins mounted as module imports. `clock.plugin.ts` uses
`defineElysiaPlugin`, so it mounts through `imports`, types a handler without
`typeof`, and exposes its state directly through typed `@Store()` injection.
`budget.plugin.ts` uses `registerAsync` to build a plugin from an injected
provider.

## Run

```bash
bun run example:native-plugins
```

## Test

```bash
bun run --cwd examples/native-plugins test
```

`test/native-plugins.e2e-spec.ts` asserts decorators, state, global and scoped derives, a plugin-local derive staying inside the plugin, deduplication by key, and the duplicate-key failure.

[Every example](../README.md)
