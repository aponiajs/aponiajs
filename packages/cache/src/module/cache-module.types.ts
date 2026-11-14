import type { CacheStore } from "../store/cache-store.types.ts";

/** Options a cache registration accepts. */
export interface CacheModuleOptions {
  /** The store to use; defaults to a bounded in-memory store. */
  readonly store?: CacheStore;
  /** The default entry lifetime in milliseconds; defaults to 60 seconds. */
  readonly ttlMs?: number;
  /** The in-memory store's entry cap; ignored when `store` is supplied. */
  readonly maxEntries?: number;
  /** A prefix applied to every key this registration owns. */
  readonly keyPrefix?: string;
}

/** The validated options the service and store receive. */
export interface ResolvedCacheOptions {
  readonly ttlMs: number;
  readonly maxEntries: number;
  readonly keyPrefix: string;
}
