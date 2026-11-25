/** One response recorded against an idempotency key. */
export interface StoredIdempotentResponse {
  /** The status the first request answered. */
  readonly status: number;
  /** The response body text the first request answered with. */
  readonly value: unknown;
  /** The `content-type` the recorded answer carried, when it stated one. */
  readonly contentType?: string | undefined;
  /** A digest of the method, path, and request body the key was used with. */
  readonly fingerprint: string;
}

/** The storage contract an idempotency registration accepts. */
export interface IdempotencyStore {
  get(
    key: string,
  ): StoredIdempotentResponse | undefined | Promise<StoredIdempotentResponse | undefined>;
  set(key: string, response: StoredIdempotentResponse, ttlMs: number): void | Promise<void>;
  delete(key: string): boolean | Promise<boolean>;
  clear(): void | Promise<void>;
  /**
   * Claims a key for one in-flight request.
   *
   * Optional: a custom store without it keeps the single-process guarantee. A
   * shared store implements it atomically (`SET NX` in Redis) so two replicas
   * cannot both run the handler. The claim is released on success or failure,
   * and expires after `ttlMs` so a crashed claimant cannot block a key.
   */
  claim?(key: string, ttlMs: number): boolean | Promise<boolean>;
  /** Releases a claim made by {@link claim}. */
  release?(key: string): void | Promise<void>;
}
