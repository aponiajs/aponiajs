/** The Redis client interface expected by store adapters. */
export type { RedisClientInterface, RedisStoreOptions } from "./common/redis.types.ts";

/** Redis-backed cache store implementing CacheStore. */
export { RedisCacheStore } from "./stores/redis-cache-store.ts";

/** Redis-backed rate-limit store implementing RateLimitStore. */
export { RedisRateLimitStore } from "./stores/redis-rate-limit-store.ts";

/** Redis-backed session store implementing SessionStore. */
export { RedisSessionStore } from "./stores/redis-session-store.ts";

/** Redis-backed idempotency store implementing IdempotencyStore. */
export { RedisIdempotencyStore } from "./stores/redis-idempotency-store.ts";

/** Redis-backed token revocation store implementing RevocationStore. */
export { RedisRevocationStore, RedisRefreshTokenStore } from "./stores/redis-auth-stores.ts";
