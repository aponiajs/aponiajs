# @aponiajs/redis — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

`RedisModule`, `RedisService`, and distributed Redis-backed store implementations
for `@aponiajs/cache`, `@aponiajs/rate-limit`, `@aponiajs/session`, `@aponiajs/auth`,
`@aponiajs/idempotency`, and `@aponiajs/cron`. It is a leaf: nothing in the
framework depends on it.

| Domain                                          | Owns                                                                                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redis.module.ts`, `redis.module-definition.ts` | `RedisModule.forRoot`/`forRootAsync`, `ConfigurableModuleBuilder`                                                                                              |
| `redis.constants.ts`                            | `REDIS_OPTIONS` and `REDIS_CLIENT` tokens                                                                                                                      |
| `redis.service.ts`                              | Connection lifecycle, `ping()`, prefix helper, store factory methods                                                                                           |
| `stores/`                                       | `RedisCacheStore`, `RedisRateLimitStore`, `RedisSessionStore`, `RedisRefreshTokenStore`, `RedisRevocationStore`, `RedisIdempotencyStore`, `RedisCronLockStore` |
| `interfaces/`                                   | `RedisClientLike` and `RedisModuleOptions`                                                                                                                     |

`src/index.ts` is the only public barrel.

## Invariants

- **Zero mandatory runtime bloat.** `redis@^6.3.1` is an optional peer; callers
  may inject any `RedisClientLike` or let `RedisModule` construct one from `url`.
- **Owned client cleanup.** `OnModuleDestroy` calls `quit()` only when
  `RedisModule` created the client itself, never on a caller-injected client.
- **Configuration failures are `AponiaError` with `INVALID_REDIS_OPTIONS`.**

## Tests

`src/**/*.spec.ts` under Bun (deterministic mock client), `test/*.conformance.ts`
under Vite+, and `test/redis.e2e-spec.ts` against a live Redis when `REDIS_URL` is set.
