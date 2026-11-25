import { createToken } from "@aponiajs/common";
import type { RegistrationRateLimitOptions } from "./rate-limit.interface.ts";
import type { RateLimitStore } from "../store/rate-limit-store.interface.ts";

/** The store a registration provides. */
export const RATE_LIMIT_STORE = createToken<RateLimitStore>("aponia.rate-limit.store");

/** The resolved options the service and guard read. */
export const RATE_LIMIT_OPTIONS = createToken<RegistrationRateLimitOptions>(
  "aponia.rate-limit.options",
);
