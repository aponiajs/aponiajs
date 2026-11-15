import { SetMetadata } from "@aponiajs/common";
import type { RateLimitOverride } from "../module/rate-limit.types.ts";

/** The custom metadata key the guard reads. */
export const rateLimitMetadataKey = "rate-limit";

/**
 * Overrides the registration's limit, window, or bucket key for one route.
 *
 * @param options - The route-specific limit, window, and key.
 * @returns A class and method decorator recording the override.
 */
export function RateLimit(options: RateLimitOverride = {}): ClassDecorator & MethodDecorator {
  return SetMetadata(rateLimitMetadataKey, Object.freeze({ ...options }));
}
