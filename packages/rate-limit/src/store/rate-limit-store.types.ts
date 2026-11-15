import type { RateLimitCounter } from "../module/rate-limit.types.ts";

/** The storage contract a rate-limit registration accepts. */
export interface RateLimitStore {
  /** Increments one bucket and answers its current window. */
  increment(key: string, windowMs: number): RateLimitCounter | Promise<RateLimitCounter>;
}
