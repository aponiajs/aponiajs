import type { ExecutionContext } from "@aponiajs/common";
import type { RateLimitStore } from "../store/rate-limit-store.types.ts";

/** The fixed-window counter a store returns for one key. */
export interface RateLimitCounter {
  readonly count: number;
  readonly resetAt: number;
}

/** The decision a guard acts on. */
export interface RateLimitDecision extends RateLimitCounter {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
}

/** A function deriving one bucket key from the route context. */
export type RateLimitKey = (context: ExecutionContext) => string;

/** Options a rate-limit registration accepts. */
export interface RateLimitOptions {
  /** The maximum number of requests in one window; defaults to 60. */
  readonly limit?: number;
  /** The window length in milliseconds; defaults to 60 seconds. */
  readonly windowMs?: number;
  /** The store to use; defaults to a bounded in-memory store. */
  readonly store?: RateLimitStore;
  /** The in-memory store's key cap; ignored when `store` is supplied. */
  readonly maxKeys?: number;
  /** The default bucket key; defaults to the route identity, never a spoofable header. */
  readonly key?: RateLimitKey;
}

/** The validated options the service and guard receive. */
export interface ResolvedRateLimitOptions {
  readonly limit: number;
  readonly windowMs: number;
  readonly maxKeys: number;
  readonly key: RateLimitKey | undefined;
}

/** Per-route overrides `@RateLimit()` declares. */
export interface RateLimitOverride {
  readonly limit?: number;
  readonly windowMs?: number;
  readonly key?: RateLimitKey;
}
