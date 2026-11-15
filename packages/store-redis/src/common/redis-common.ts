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

/**
 * Deletes every key matching a pattern without blocking a shared Redis.
 *
 * `SCAN` pages the keyspace and `UNLINK` frees the values in the background.
 * A client that implements neither falls back to `KEYS`/`DEL`, which is the
 * previous behavior; the fallback is explicit so a store's `clear()` still
 * works on a minimal client.
 *
 * @internal
 */
export async function deleteByPattern(
  client: RedisClientInterface,
  pattern: string,
): Promise<void> {
  let cursor = "0";
  do {
    const page =
      client.scan === undefined
        ? { cursor: "0", keys: await client.keys(pattern) }
        : await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = page.cursor;
    await deleteKeys(client, page.keys);
  } while (cursor !== "0");
}

/**
 * Deletes one page of keys, preferring non-blocking `UNLINK`.
 *
 * @internal
 */
export async function deleteKeys(
  client: RedisClientInterface,
  keys: readonly string[],
): Promise<number> {
  if (keys.length === 0) {
    return 0;
  }
  return client.unlink === undefined ? await client.del(keys) : await client.unlink(keys);
}
