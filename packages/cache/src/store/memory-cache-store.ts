import { AponiaError } from "@aponiajs/common";
import type { CacheStore } from "./cache-store.types.ts";
import type { MemoryCacheStoreOptions } from "./memory-cache-store.types.ts";

interface MemoryEntry {
  readonly value: unknown;
  readonly expiresAt: number;
}

const defaultMaxEntries = 1_000;

/**
 * A bounded in-memory cache store.
 *
 * Expiry is lazy: an expired entry is removed when it is read, and inserting a
 * new key into a full store evicts the oldest insertion. No timer is created per
 * entry, so a large cache costs no scheduled work.
 */
export class MemoryCacheStore implements CacheStore {
  readonly #entries = new Map<string, MemoryEntry>();
  readonly #maxEntries: number;
  readonly #now: () => number;

  constructor(options: MemoryCacheStoreOptions = {}) {
    const maxEntries = options.maxEntries ?? defaultMaxEntries;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new AponiaError(
        "INVALID_CONFIGURATION_VALUE",
        `MemoryCacheStore maxEntries must be a positive integer, received ${String(maxEntries)}.`,
        {
          configuration: "cache",
          issues: Object.freeze(["maxEntries must be a positive integer"]),
        },
      );
    }
    this.#maxEntries = maxEntries;
    this.#now = options.now ?? Date.now;
  }

  get<T>(key: string): T | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      this.#entries.delete(key);
      return;
    }

    if (!this.#entries.has(key) && this.#entries.size >= this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) {
        this.#entries.delete(oldest);
      }
    }

    this.#entries.set(key, Object.freeze({ value, expiresAt: this.#now() + ttlMs }));
  }

  delete(key: string): boolean {
    return this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }

  /** The number of entries retained, including entries whose time has elapsed. */
  get size(): number {
    return this.#entries.size;
  }
}
