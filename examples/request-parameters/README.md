# Request parameters

Every parameter decorator: `@Body`, `@Query`, `@Param`, `@Headers`, `@Cookie`, `@Req`, `@Res`, and `@Ctx`, each shown both whole and selecting a single property, plus a handler that takes the context with no decorator at all.

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
