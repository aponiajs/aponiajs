import { createToken } from "@aponiajs/common";
import type { CacheStore } from "../store/cache-store.types.ts";
import type { ResolvedCacheOptions } from "./cache-module.types.ts";

/** The store a cache registration provides; export it for advanced composition. */
export const CACHE_STORE = createToken<CacheStore>("aponia.cache.store");

/** The resolved options the service reads. */
export const CACHE_OPTIONS = createToken<ResolvedCacheOptions>("aponia.cache.options");
