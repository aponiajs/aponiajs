/**
 * `@aponiajs/cache` — bounded application caching.
 *
 * The package owns the cache contract, a bounded in-memory store, and the
 * service an application injects. It is a leaf: nothing in the framework
 * depends on it. Applications that need a shared or distributed cache supply a
 * `CacheStore` and keep this package's TTL and key rules.
 */
export { CacheModule } from "./cache.module.ts";
export { CACHE_MANAGER, CACHE_STORE } from "./cache.constants.ts";
export {
  MODULE_OPTIONS_TOKEN,
  type CacheModuleExtras,
  type CacheModuleRegistrationAsyncOptions,
  type CacheModuleSyncOptions,
} from "./cache.module-definition.ts";
export type {
  CacheModuleAsyncOptions,
  CacheModuleOptions,
} from "./interfaces/cache-module.interface.ts";
export { CacheService } from "./cache.service.ts";
export type { CacheEntryOptions } from "./interfaces/cache-service.interface.ts";
export { CacheKey } from "./decorators/cache-key.decorator.ts";
export { CacheTTL } from "./decorators/cache-ttl.decorator.ts";
export { CacheInterceptor } from "./interceptors/cache.interceptor.ts";
export { MemoryCacheStore } from "./memory-cache.store.ts";
export type { MemoryCacheStoreOptions } from "./interfaces/memory-cache-store.interface.ts";
export type { CacheStore } from "./interfaces/cache-store.interface.ts";
