import { Inject, Injectable } from "@aponiajs/common";
import { CACHE_OPTIONS, CACHE_STORE } from "../module/cache-module.constants.ts";
import type { ResolvedCacheOptions } from "../module/cache-module.types.ts";
import type { CacheStore } from "../store/cache-store.types.ts";
import type { CacheEntryOptions } from "./cache-service.types.ts";

/**
 * The cache an application injects.
 *
 * Keys are prefixed by the registration, `undefined` is never stored, and every
 * write carries a positive TTL. A store may be synchronous or asynchronous; the
 * service awaits either shape.
 */
@Injectable()
export class CacheService {
  readonly #store: CacheStore;
  readonly #options: ResolvedCacheOptions;
  readonly #inflight = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(CACHE_STORE) store: CacheStore,
    @Inject(CACHE_OPTIONS) options: ResolvedCacheOptions,
  ) {
    this.#store = store;
    this.#options = options;
  }

  /** Reads one value, or `undefined` when it is absent or expired. */
  async get<T>(key: string): Promise<T | undefined> {
    return await this.#store.get<T>(this.#key(key));
  }

  /** Stores one value; `undefined` deletes the entry instead. */
  async set<T>(key: string, value: T, options: CacheEntryOptions = {}): Promise<void> {
    const ttlMs = options.ttlMs ?? this.#options.ttlMs;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      await this.delete(key);
      return;
    }
    await this.#store.set(this.#key(key), value, ttlMs);
  }

  /** Removes one entry and answers whether it existed. */
  async delete(key: string): Promise<boolean> {
    return await this.#store.delete(this.#key(key));
  }

  /** Removes every entry owned by this registration. */
  async clear(): Promise<void> {
    await this.#store.clear();
  }

  /**
   * Reads a value, or computes and stores it when absent.
   *
   * Concurrent calls for one key share a single factory run, so a burst of
   * misses does not stampede the origin. A rejection is shared with the
   * callers waiting on it and leaves no entry behind, so the next call retries.
   */
  async wrap<T>(
    key: string,
    factory: () => T | Promise<T>,
    options: CacheEntryOptions = {},
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }
    const fullKey = this.#key(key);
    const existing = this.#inflight.get(fullKey) as Promise<T> | undefined;
    if (existing !== undefined) {
      return await existing;
    }
    const pending = (async (): Promise<T> => {
      const value = await factory();
      if (value !== undefined) {
        await this.set(key, value, options);
      }
      return value;
    })();
    this.#inflight.set(fullKey, pending as Promise<unknown>);
    try {
      return await pending;
    } finally {
      this.#inflight.delete(fullKey);
    }
  }

  #key(key: string): string {
    return `${this.#options.keyPrefix}${key}`;
  }
}
