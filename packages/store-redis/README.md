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
  success or failure. Response records live under `response:` and claims under
  `claim:`, and the caller's key is percent-encoded inside its segment, so one
  key cannot spell another record's internal name.
- `RedisRefreshTokenStore` consumes a token in one Lua round trip and keeps a
  short family tombstone so a replay can revoke the family.
- Every store exposes an idempotent `close()` and `Symbol.asyncDispose`. It
  releases the client it was given unless `closeClient: false` is stated; a
  client shared by several stores is released once, so the first `close()` quits
  it and the rest resolve. A cache write with no lifetime persists without `EX`.
