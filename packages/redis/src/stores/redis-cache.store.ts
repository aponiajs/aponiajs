import type { RedisClientLike } from "../interfaces/redis-client.interface.ts";

/** Redis-backed implementation of `@aponiajs/cache`'s `CacheStore`. */
export class RedisCacheStore {
  readonly #client: RedisClientLike;
  readonly #prefix: string;

  constructor(client: RedisClientLike, prefix = "aponia:cache:") {
    this.#client = client;
    this.#prefix = prefix;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.#client.get(this.#prefix + key);
    if (raw === null) {
      return undefined;
    }
    return JSON.parse(raw) as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlMs !== undefined && ttlMs > 0) {
      await this.#client.set(this.#prefix + key, serialized, { PX: ttlMs });
      return;
    }
    await this.#client.set(this.#prefix + key, serialized);
  }

  async delete(key: string): Promise<boolean> {
    const deleted = await this.#client.del(this.#prefix + key);
    return deleted > 0;
  }

  async clear(): Promise<void> {
    await deleteByPrefix(this.#client, this.#prefix);
  }
}

export async function deleteByPrefix(client: RedisClientLike, prefix: string): Promise<void> {
  if (client.scan === undefined) {
    return;
  }
  let cursor: string | number = "0";
  do {
    const page = await client.scan(cursor, { MATCH: `${prefix}*`, COUNT: 100 });
    cursor = page.cursor;
    if (page.keys.length > 0) {
      await client.del(page.keys);
    }
  } while (String(cursor) !== "0");
}
