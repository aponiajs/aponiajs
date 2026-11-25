import type { ModuleAsyncOptions } from "@aponiajs/common";
import type { CacheStore } from "./cache-store.interface.ts";

/** Options a cache registration accepts. */
export interface CacheModuleOptions {
  /** The store to use; defaults to a bounded in-memory store. */
  readonly store?: CacheStore;
  /**
   * The default entry lifetime in milliseconds.
   *
   * Omitted means no expiry, matching `@nestjs/cache-manager`'s default TTL,
   * which is unset. A non-positive or non-finite value is refused at
   * registration.
   */
  readonly ttlMs?: number;
  /** The in-memory store's entry cap; ignored when `store` is supplied. */
  readonly maxEntries?: number;
  /** A prefix applied to every key this registration owns. */
  readonly keyPrefix?: string;
}

/** The validated options the service and store receive. */
export interface ResolvedCacheOptions {
  /** The default entry lifetime, or `undefined` for an entry that never expires. */
  readonly ttlMs: number | undefined;
  readonly maxEntries: number;
  readonly keyPrefix: string;
}

/** The registration options a factory supplies. */
export type CacheModuleAsyncOptions = ModuleAsyncOptions<CacheModuleOptions>;

/** The resolved options plus the store the caller supplied, read by the store provider. */
export interface RegistrationCacheOptions extends ResolvedCacheOptions {
  readonly store?: CacheStore;
}
