import { createToken } from "@aponiajs/common";
import type { ResolvedRateLimitOptions } from "./rate-limit.types.ts";
import type { RateLimitStore } from "../store/rate-limit-store.types.ts";

/** The store a registration provides. */
export const RATE_LIMIT_STORE = createToken<RateLimitStore>("aponia.rate-limit.store");

/** The resolved options the service and guard read. */
export const RATE_LIMIT_OPTIONS = createToken<ResolvedRateLimitOptions>(
  "aponia.rate-limit.options",
);
