# @aponiajs/cache — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The cache module, the cache service, the store contract, and the bounded
in-memory store. It is a leaf: nothing in the framework depends on it.

| Domain     | Owns                                                                  |
| ---------- | --------------------------------------------------------------------- |
| `module/`  | `CacheModule.register`, the tokens, and the resolved options contract |
| `service/` | `CacheService` and per-entry options                                  |
| `store/`   | `CacheStore`, `MemoryCacheStore`, and their contracts                 |

`src/index.ts` is the only public barrel. Keep `*.types.ts` beside the runtime
that reads it.

## Invariants

- **The cache is application-level, not HTTP-level.** It does not set
  `Cache-Control`, `ETag`, or `Vary`; a route that needs HTTP caching declares
  those on its response. Do not add route-level response caching without a
  separate opt-in that states the request-safety rules.
- **`undefined` means absent.** `CacheService.set` deletes on `undefined`, and
  `get` answers `undefined` for a miss. Do not add a second sentinel.
- **Every entry has a positive TTL.** A non-positive or non-finite TTL deletes
  the entry. There is no unbounded mode.
- **The memory store is bounded.** Insertion into a full store evicts the oldest
  insertion. Expiry is lazy and creates no timer per entry.
- **Values are references.** The package does not clone, serialize, encrypt, or
  validate cached values. Callers that store secrets own their lifetime and
  must clear them deliberately.
- **`wrap` is single-flight per key.** Concurrent misses share one factory run
  and one rejection; a failure leaves no entry, and a later call retries. Do not
  remove the in-flight map without replacing the stampede guarantee.
- **A custom store is trusted code.** The package validates its own options; it
  does not sandbox a store implementation.
- **Configuration failures are `AponiaError` with
  `INVALID_CONFIGURATION_VALUE` and a frozen issue list.** Keep the code and the
  total issue list; tests assert both.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. Both lanes
boot a real application through `AponiaFactory.create` and read the injected
`CacheService`; the memory store's clock is injectable, so no case sleeps for a
TTL.
