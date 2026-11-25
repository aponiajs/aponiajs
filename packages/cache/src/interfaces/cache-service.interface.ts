/** Per-entry options a cache write accepts. */
export interface CacheEntryOptions {
  /** The entry lifetime; defaults to the module's `ttlMs`. */
  readonly ttlMs?: number;
}
