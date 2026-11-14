import { AponiaError } from "@aponiajs/common";
import type { RateLimitCounter } from "../module/rate-limit.types.ts";
import type { RateLimitStore } from "./rate-limit-store.types.ts";
import type { MemoryRateLimitStoreOptions } from "./memory-rate-limit-store.types.ts";

const defaultMaxKeys = 10_000;

/**
 * A bounded fixed-window store.
 *
 * Each bucket resets when its window ends. Inserting a new key into a full store
 * evicts the oldest insertion, so a hostile key space cannot grow memory without
 * bound.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  readonly #buckets = new Map<string, RateLimitCounter>();
  readonly #maxKeys: number;
  readonly #now: () => number;

  constructor(options: MemoryRateLimitStoreOptions = {}) {
    const maxKeys = options.maxKeys ?? defaultMaxKeys;
    if (!Number.isInteger(maxKeys) || maxKeys < 1) {
      throw new AponiaError(
        "INVALID_RATE_LIMIT",
        `MemoryRateLimitStore maxKeys must be a positive integer, received ${String(maxKeys)}.`,
        { issues: Object.freeze(["maxKeys must be a positive integer"]) },
      );
    }
    this.#maxKeys = maxKeys;
    this.#now = options.now ?? Date.now;
  }

  increment(key: string, windowMs: number): RateLimitCounter {
    const now = this.#now();
    const existing = this.#buckets.get(key);
    if (existing === undefined || existing.resetAt <= now) {
      if (existing === undefined && this.#buckets.size >= this.#maxKeys) {
        const oldest = this.#buckets.keys().next().value;
        if (oldest !== undefined) {
          this.#buckets.delete(oldest);
        }
      }
      const counter = Object.freeze({ count: 1, resetAt: now + windowMs });
      this.#buckets.set(key, counter);
      return counter;
    }

    const counter = Object.freeze({ count: existing.count + 1, resetAt: existing.resetAt });
    this.#buckets.set(key, counter);
    return counter;
  }

  /** The number of buckets retained, including windows whose time has elapsed. */
  get size(): number {
    return this.#buckets.size;
  }
}
