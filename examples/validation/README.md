# Validation

Separate `@Validation()` classes reject bad input before the handler runs. The
body model uses Zod through Standard Schema, while the query and header models
use Elysia's native `t`. Controllers name the model classes directly without
repeating schema-derived types.

## Run

```bash
bun run example:validation
```

## Test

```bash
bun run --cwd examples/validation test
```

`test/validation.e2e-spec.ts` asserts both directions of every slot, including a rejected request never reaching the handler.

[Every example](../README.md)
