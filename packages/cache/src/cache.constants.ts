import { createToken } from "@aponiajs/common";
import type { CacheService } from "./cache.service.ts";
import type { CacheStore } from "./interfaces/cache-store.interface.ts";
import type { RegistrationCacheOptions } from "./interfaces/cache-module.interface.ts";

/** The store a cache registration provides; export it for advanced composition. */
export const CACHE_STORE = createToken<CacheStore>("aponia.cache.store");

/** The resolved options the service reads. */
export const CACHE_OPTIONS = createToken<RegistrationCacheOptions>("aponia.cache.options");

/**
 * The cache manager token, as `@nestjs/cache-manager` spells it.
 *
 * The registration aliases this token to `CacheService`, so
 * `@Inject(CACHE_MANAGER)` and injecting the class answer the same instance.
 */
export const CACHE_MANAGER = createToken<CacheService>("CACHE_MANAGER");
