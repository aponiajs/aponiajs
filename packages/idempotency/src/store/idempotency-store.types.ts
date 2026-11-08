/** One response recorded against an idempotency key. */
export interface StoredIdempotentResponse {
  /** The status the first request answered. */
  readonly status: number;
  /** The handler's result; it must be JSON-serializable. */
  readonly value: unknown;
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
}
