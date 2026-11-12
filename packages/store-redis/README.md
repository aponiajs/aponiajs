# @aponiajs/store-redis

Redis-backed storage adapters for AponiaJS distributed caching, rate-limiting, session management, idempotency replay, and authentication token revocation.

## Installation

```bash
bun add @aponiajs/store-redis@alpha redis
```

## Stores

- **RedisCacheStore**: Implements `CacheStore` for `@aponiajs/cache`
- **RedisRateLimitStore**: Implements `RateLimitStore` for `@aponiajs/rate-limit`
- **RedisSessionStore**: Implements `SessionStore` for `@aponiajs/session`
- **RedisIdempotencyStore**: Implements `IdempotencyStore` for `@aponiajs/idempotency`
- **RedisRevocationStore**: Implements `RevocationStore` for `@aponiajs/auth`
- **RedisRefreshTokenStore**: Implements `RefreshTokenStore` for `@aponiajs/auth`

## Behavior

- `clear()` pages the keyspace with `SCAN` and deletes with `UNLINK` when the
  client implements them; a minimal client falls back to `KEYS`/`DEL`.
- `RedisRateLimitStore` reports the bucket's live `PTTL`, so `RateLimit-Reset`
  and `Retry-After` do not slide forward on every increment.
- `RedisIdempotencyStore` claims a key with `SET NX PX` and releases it on
  success or failure.
- `RedisRefreshTokenStore` consumes a token in one Lua round trip and keeps a
  short family tombstone so a replay can revoke the family.
