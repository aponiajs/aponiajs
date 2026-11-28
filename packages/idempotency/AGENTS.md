# @aponiajs/idempotency — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

`Idempotency-Key` request deduplication, concurrent in-flight `409 Conflict`
protection, payload mismatch `422` detection, response replay, and a bounded
in-memory `IdempotencyStore` (with Redis-backed distributed support in
`@aponiajs/redis`). It is a leaf: nothing in the framework depends on it.

| Domain                                                      | Owns                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| `idempotency.module.ts`, `idempotency.module-definition.ts` | `IdempotencyModule.forRoot`/`forRootAsync`                                 |
| `idempotency.constants.ts`                                  | Options, store tokens, and defaults                                        |
| `idempotency-lifecycle.provider.ts`                         | `RequestLifecycleHook` handling `Idempotency-Key` acquire/complete/release |
| `store/`                                                    | `MemoryIdempotencyStore` bounded in-memory implementation                  |
| `interfaces/`                                               | `IdempotencyStore`, `IdempotencyRecord`, and module options                |

`src/index.ts` is the only public barrel.

## Invariants

- **Fail-closed on store errors.** If `store.acquire` or `store.complete`
  throws, the hook returns `503 Service Unavailable` rather than silently
  executing a non-deduplicated mutation.
- **Concurrent in-flight conflict.** While a key is in flight, duplicate
  requests receive `409 Conflict`.
- **Payload mismatch detection.** Reusing an `Idempotency-Key` with a different
  method, path, or body returns `422 Unprocessable Entity`.
- **Configuration failures are `AponiaError` with `INVALID_IDEMPOTENCY_OPTIONS`.**

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+.
