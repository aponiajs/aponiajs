/**
 * The storage contract a cache registration accepts.
 *
 * A store may answer synchronously or asynchronously. `undefined` means absent:
 * the cache never stores `undefined`, so a caller can tell a miss from a stored
 * value without a second lookup.
 */
export interface CacheStore {
  /** Reads a value, or `undefined` when it is absent or expired. */
  get<T>(key: string): T | undefined | Promise<T | undefined>;
  /**
   * Stores a value for the given lifetime.
   *
   * An omitted lifetime means the entry never expires, which is the module's
   * default. A non-positive lifetime is the caller's request to remove the
   * entry, and the service does that before reaching the store.
   */
  set<T>(key: string, value: T, ttlMs?: number): void | Promise<void>;
  /** Removes one entry and answers whether it existed. */
  delete(key: string): boolean | Promise<boolean>;
  /** Removes every entry this store owns. */
  clear(): void | Promise<void>;
}
