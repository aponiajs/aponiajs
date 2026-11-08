# @aponiajs/idempotency — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The request plugin that records and replays a mutating request against its
idempotency key, the bounded default store, and the replay contract. It is a
leaf: nothing in the framework depends on it.

| Domain     | Owns                                                           |
| ---------- | -------------------------------------------------------------- |
| `module/`  | `IdempotencyModule.register` and the resolved option contract  |
| `runtime/` | The global plugin, fingerprinting, replay, and conflict checks |
| `store/`   | `IdempotencyStore`, the stored shape, and the memory store     |

`src/index.ts` is the only public barrel.

## Invariants

- **A key is bound to its request.** The fingerprint covers method, path, and
  body; a key reused for a different request is `409`, never a replay of an
  unrelated answer.
- **Only a recorded `2xx` is replayed.** A failure is not recorded, so a retry
  runs the handler again. A `Response`, stream, generator, or `undefined` result
  is never stored.
- **Concurrent repeats share one run.** The in-flight map is what stops a burst
  from executing the handler twice; release it on success and on failure.
- **Replay restores status and body only.** Do not claim response headers a
  handler set itself are restored.
- **The default store is process-local and bounded.** Never describe it as
  shared; a multi-instance deployment supplies an `IdempotencyStore`.
- **Store failures never replace the answer.** Report through `onError` and let
  the response stand.
- **Configuration failures are `AponiaError` with
  `INVALID_IDEMPOTENCY_OPTIONS` and a frozen issue list.**

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. The Bun
lane boots a real application through `AponiaFactory.create` and drives it
through `application.handle`.
