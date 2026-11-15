/**
 * `@aponiajs/rate-limit` — bounded request rate limiting.
 *
 * The package owns a fixed-window store contract, a bounded in-memory store, a
 * guard, and the route decorator. It is a leaf: nothing in the framework
 * depends on it.
 */
export { RateLimitModule } from "./module/rate-limit-module.ts";
export { RATE_LIMIT_OPTIONS, RATE_LIMIT_STORE } from "./module/rate-limit-module.constants.ts";
export { RateLimit } from "./guard/rate-limit.decorator.ts";
export { RateLimitGuard } from "./guard/rate-limit.guard.ts";
export { RateLimitService } from "./service/rate-limit.service.ts";
export { MemoryRateLimitStore } from "./store/memory-rate-limit-store.ts";
export type {
  RateLimitCounter,
  RateLimitDecision,
  RateLimitKey,
  RateLimitOptions,
  RateLimitOverride,
  ResolvedRateLimitOptions,
} from "./module/rate-limit.types.ts";
export type { RateLimitStore } from "./store/rate-limit-store.types.ts";
export type { MemoryRateLimitStoreOptions } from "./store/memory-rate-limit-store.types.ts";
