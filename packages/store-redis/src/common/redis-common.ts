import { AponiaError } from "@aponiajs/common";
import type { RedisClientInterface, RedisStoreOptions } from "./redis.types.ts";

/**
 * Validates and normalizes common Redis store options.
 *
 * @internal
 */
export function resolveRedisStoreOptions(
  options: RedisStoreOptions,
  defaultPrefix: string,
  storeName: string,
): { readonly client: RedisClientInterface; readonly prefix: string } {
  if (typeof options !== "object" || options === null) {
    throw new AponiaError("INVALID_CONFIGURATION", `The ${storeName} options must be an object.`, {
      store: storeName,
    });
  }

  if (typeof options.client !== "object" || options.client === null) {
    throw new AponiaError(
      "INVALID_CONFIGURATION",
      `The ${storeName} requires a valid Redis client object.`,
      { store: storeName },
    );
  }

  const prefix = options.prefix ?? defaultPrefix;
  if (typeof prefix !== "string") {
    throw new AponiaError("INVALID_CONFIGURATION", `The ${storeName} prefix must be a string.`, {
      store: storeName,
    });
  }

  return Object.freeze({
    client: options.client,
    prefix,
  });
}
