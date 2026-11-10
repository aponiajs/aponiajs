import type { CacheStore } from "@aponiajs/cache";
import { resolveRedisStoreOptions } from "../common/redis-common.ts";
import type { RedisClientInterface, RedisStoreOptions } from "../common/redis.types.ts";

/**
 * Redis-backed cache store implementing CacheStore.
 */
export class RedisCacheStore implements CacheStore {
  readonly #client: RedisClientInterface;
  readonly #prefix: string;

  constructor(options: RedisStoreOptions) {
    const resolved = resolveRedisStoreOptions(options, "aponia:cache:", "RedisCacheStore");
    this.#client = resolved.client;
    this.#prefix = resolved.prefix;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.#client.get(this.#key(key));
    if (raw === null || raw === undefined) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) {
      await this.delete(key);
      return;
    }
    const serialized = JSON.stringify(value);
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    await this.#client.set(this.#key(key), serialized, { EX: ttlSeconds });
  }

  async delete(key: string): Promise<boolean> {
    const count = await this.#client.del(this.#key(key));
    return count > 0;
  }

  async clear(): Promise<void> {
    const pattern = `${this.#prefix}*`;
    const keys = await this.#client.keys(pattern);
    if (keys.length > 0) {
      await this.#client.del(keys);
    }
  }

  #key(key: string): string {
    return `${this.#prefix}${key}`;
  }
}
