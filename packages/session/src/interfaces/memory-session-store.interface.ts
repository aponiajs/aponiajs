/** Options for the bounded in-memory session store. */
export interface MemorySessionStoreOptions {
  /** The maximum number of sessions; the oldest insertion is evicted first. */
  readonly maxSessions?: number;
  /** A clock, so tests can advance time without sleeping. Defaults to `Date.now`. */
  readonly now?: () => number;
}
