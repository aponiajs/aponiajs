/** Options that name a lifetime scope in failures and inspection. */
export interface LifetimeScopeOptions {
  /** The human label failures carry; defaults to `"lifetime"`. */
  readonly label?: string;
}

/**
 * The narrow view of a scope a {@link Scoped} handle reads.
 *
 * Keeping the handle on an interface rather than the concrete scope is what
 * lets the handle live in its own module without a runtime import cycle.
 */
export interface LifetimeHandleController {
  /** The label the scope reports in failures. */
  readonly label: string;
  /**
   * Refuses an operation once the scope has exited.
   *
   * @param operation - The operation being attempted, for failure details.
   * @throws An `AponiaError` with `STALE_LIFETIME` when the scope is closed.
   */
  assertOpen(operation: string): void;
}
