/** Handle returned when a distributed cron lock is acquired. */
export interface CronLockHandle {
  /** Releases the acquired lock. */
  release(): Promise<void>;
}

/**
 * Optional distributed lock store preventing duplicate cron execution across
 * multiple application replicas.
 */
export interface CronLockStore {
  /**
   * Attempts to acquire an exclusive lock for `key` for at most `ttlMs` ms.
   * Returns a handle when acquired, or `undefined` when another replica holds it.
   */
  acquire(key: string, ttlMs: number): Promise<CronLockHandle | undefined>;
}
