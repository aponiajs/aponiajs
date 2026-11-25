# @aponiajs/cache — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The cache module, the cache service, the store contract, and the bounded
in-memory store. It is a leaf: nothing in the framework depends on it.

| Domain                                          | Owns                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `cache.module.ts`, `cache.module-definition.ts` | `CacheModule.forRoot`, the tokens, and the resolved options contract |
| `cache.service.ts`                              | `CacheService` and per-entry options                                 |
| `memory-cache.store.ts`                         | The bounded default store                                            |
| `decorators/`                                   | `@CacheKey()` and `@CacheTTL()` metadata                             |
| `interceptors/`                                 | `CacheInterceptor`, the `GET`-only response writer                   |
| `interfaces/`                                   | The module, service, store, and memory-store contracts               |

`src/index.ts` is the only public barrel. Type-only contracts live in
`interfaces/<name>.interface.ts`. The registration is a `ConfigurableModuleBuilder` definition:
`MODULE_OPTIONS_TOKEN`, `OPTIONS_TYPE`, and `ASYNC_OPTIONS_TYPE` come from
`cache.module-definition.ts`, `register`/`registerAsync` remain as deprecated
aliases, and `isGlobal` is the definition-shaping extra.

## Invariants

- **The cache is application-level, not HTTP-level.** It does not set
  `Cache-Control`, `ETag`, or `Vary`; a route that needs HTTP caching declares
  those on its response. Do not add route-level response caching without a
  separate opt-in that states the request-safety rules. `CacheInterceptor` only
  writes a `GET` response; it cannot replay one, because Aponia's interceptor
  contract has no `next.handle()` — read-through is `CacheService.wrap`.
- **`undefined` means absent.** `CacheService.set` deletes on `undefined`, and
  `get` answers `undefined` for a miss. Do not add a second sentinel.
- **A missing TTL means no expiry, matching `@nestjs/cache-manager`.** It is the
  registration default; a non-positive or non-finite per-entry TTL deletes the
  entry. There is no other unbounded mode.
- **The memory store is bounded.** Insertion into a full store evicts the oldest
  insertion. Expiry is lazy and creates no timer per entry.
- **Values are references.** The package does not clone, serialize, encrypt, or
  validate cached values. Callers that store secrets own their lifetime and
  must clear them deliberately.
- **`CACHE_MANAGER` is the same instance as `CacheService`.** The registration
  aliases the Nest-compatible token, so `@Inject(CACHE_MANAGER)` and injecting
  the class answer one service. Do not register a second cache manager.
- **`wrap` is single-flight per key.** Concurrent misses share one factory run
  and one rejection; a failure leaves no entry, and a later call retries. Do not
  remove the in-flight map without replacing the stampede guarantee.
- **A custom store is trusted code.** The package validates its own options; it
  does not sandbox a store implementation.
- **Configuration failures are `AponiaError` with
  `INVALID_CONFIGURATION_VALUE` and a frozen issue list.** Keep the code and the
  total issue list; tests assert both.

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+. Both lanes
boot a real application through `AponiaFactory.create` and read the injected
`CacheService`; the memory store's clock is injectable, so no case sleeps for a
TTL.
