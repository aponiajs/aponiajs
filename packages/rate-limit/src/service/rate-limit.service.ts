import { AponiaError, Inject, Injectable } from "@aponiajs/common";
import { RATE_LIMIT_OPTIONS, RATE_LIMIT_STORE } from "../module/rate-limit-module.constants.ts";
import type {
  RateLimitDecision,
  RateLimitOverride,
  ResolvedRateLimitOptions,
} from "../module/rate-limit.types.ts";
import type { RateLimitStore } from "../store/rate-limit-store.types.ts";

/** The rate-limit decision an application can read or test directly. */
@Injectable()
export class RateLimitService {
  readonly #store: RateLimitStore;
  readonly #options: ResolvedRateLimitOptions;

  constructor(
    @Inject(RATE_LIMIT_STORE) store: RateLimitStore,
    @Inject(RATE_LIMIT_OPTIONS) options: ResolvedRateLimitOptions,
  ) {
    this.#store = store;
    this.#options = options;
  }

  /** The configured default limit. */
  get limit(): number {
    return this.#options.limit;
  }

  /** The configured default window. */
  get windowMs(): number {
    return this.#options.windowMs;
  }

  /** Consumes one token for a key and answers the resulting decision. */
  async check(key: string, override: RateLimitOverride = {}): Promise<RateLimitDecision> {
    const limit = override.limit ?? this.#options.limit;
    const windowMs = override.windowMs ?? this.#options.windowMs;
    assertPositiveInteger(limit, "limit");
    assertPositiveInteger(windowMs, "windowMs");

    const counter = await this.#store.increment(key, windowMs);
    const remaining = Math.max(0, limit - counter.count);
    return Object.freeze({
      ...counter,
      limit,
      remaining,
      allowed: counter.count <= limit,
    });
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new AponiaError(
      "INVALID_RATE_LIMIT",
      `The rate limit ${name} must be a positive integer, received ${String(value)}.`,
      { issues: Object.freeze([`${name} must be a positive integer`]) },
    );
  }
}
