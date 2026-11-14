/**
 * `@aponiajs/cache` — bounded application caching.
 *
 * The package owns the cache contract, a bounded in-memory store, and the
 * service an application injects. It is a leaf: nothing in the framework
 * depends on it. Applications that need a shared or distributed cache supply a
 * `CacheStore` and keep this package's TTL and key rules.
 */
export { CacheModule } from "./module/cache-module.ts";
export { CACHE_STORE } from "./module/cache-module.constants.ts";
export type { CacheModuleOptions } from "./module/cache-module.types.ts";
export { CacheService } from "./service/cache-service.ts";
export type { CacheEntryOptions } from "./service/cache-service.types.ts";
export { MemoryCacheStore } from "./store/memory-cache-store.ts";
export type { MemoryCacheStoreOptions } from "./store/memory-cache-store.types.ts";
export type { CacheStore } from "./store/cache-store.types.ts";
