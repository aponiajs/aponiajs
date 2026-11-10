# @aponiajs/store-redis

Redis-backed storage adapters for AponiaJS distributed caching, rate-limiting, session management, idempotency replay, and authentication token revocation.

## Installation

```bash
bun add @aponiajs/store-redis@beta redis
```

## Stores

- **RedisCacheStore**: Implements `CacheStore` for `@aponiajs/cache`
- **RedisRateLimitStore**: Implements `RateLimitStore` for `@aponiajs/rate-limit`
- **RedisSessionStore**: Implements `SessionStore` for `@aponiajs/session`
- **RedisIdempotencyStore**: Implements `IdempotencyStore` for `@aponiajs/idempotency`
- **RedisRevocationStore**: Implements `RevocationStore` for `@aponiajs/auth`
- **RedisRefreshTokenStore**: Implements `RefreshTokenStore` for `@aponiajs/auth`
