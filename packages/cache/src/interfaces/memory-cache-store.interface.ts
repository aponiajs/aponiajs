/** Options for the bounded in-memory store. */
export interface MemoryCacheStoreOptions {
  /** The maximum number of live entries; the oldest insertion is evicted first. */
  readonly maxEntries?: number;
  /** A clock, so tests can advance time without sleeping. Defaults to `Date.now`. */
  readonly now?: () => number;
}
