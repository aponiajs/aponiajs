/** Options for the bounded in-memory rate-limit store. */
export interface MemoryRateLimitStoreOptions {
  /** The maximum number of buckets; the oldest insertion is evicted first. */
  readonly maxKeys?: number;
  /** A clock, so tests can advance time without sleeping. Defaults to `Date.now`. */
  readonly now?: () => number;
}
