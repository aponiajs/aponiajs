export { RedisModule } from "./redis.module.ts";
export { RedisService } from "./redis.service.ts";
export { REDIS_CLIENT, REDIS_OPTIONS } from "./redis.constants.ts";
export {
  ASYNC_OPTIONS_TYPE,
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  OPTIONS_TYPE,
  type RedisModuleExtras,
  type RedisModuleRegistrationAsyncOptions,
  type RedisModuleSyncOptions,
} from "./redis.module-definition.ts";
export { RedisCacheStore } from "./stores/redis-cache.store.ts";
export { RedisCronLockStore, type RedisCronLockHandle } from "./stores/redis-cron-lock.store.ts";
export {
  RedisIdempotencyStore,
  type RedisIdempotencyAcquireResult,
  type RedisIdempotencyRecord,
} from "./stores/redis-idempotency.store.ts";
export { RedisRateLimitStore } from "./stores/redis-rate-limit.store.ts";
export {
  RedisRefreshTokenStore,
  type RedisRefreshTokenConsumeResult,
  type RedisRefreshTokenRecord,
} from "./stores/redis-refresh-token.store.ts";
export { RedisRevocationStore } from "./stores/redis-revocation.store.ts";
export { RedisSessionStore, type RedisSessionRecord } from "./stores/redis-session.store.ts";
export type {
  RedisClientLike,
  RedisModuleAsyncOptions,
  RedisModuleOptions,
  RedisSetOptions,
  ResolvedRedisOptions,
} from "./interfaces/redis-client.interface.ts";
