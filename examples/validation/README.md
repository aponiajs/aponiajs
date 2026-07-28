# Validation

Route schemas rejecting bad input before the handler runs. The body uses Zod through Standard Schema, the query and headers use Elysia's native `t`, and the handler's own annotations provide the types.

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
