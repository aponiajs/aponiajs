import type { CacheStore } from "@aponiajs/cache";
import {
  closeRedisClient,
  deleteByPattern,
  resolveRedisStoreOptions,
} from "../common/redis-common.ts";
import type { RedisClientInterface, RedisStoreOptions } from "../interfaces/redis.interface.ts";

/**
 * Redis-backed cache store implementing CacheStore.
 */
export class RedisCacheStore implements CacheStore {
  readonly #client: RedisClientInterface;
  readonly #prefix: string;
  readonly #closeClient: boolean;
  #closed = false;

  constructor(options: RedisStoreOptions) {
    const resolved = resolveRedisStoreOptions(options, "aponia:cache:", "RedisCacheStore");
    this.#client = resolved.client;
    this.#prefix = resolved.prefix;
    this.#closeClient = resolved.closeClient;
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

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlMs === undefined) {
      await this.#client.set(this.#key(key), serialized);
      return;
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      await this.delete(key);
      return;
    }
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    await this.#client.set(this.#key(key), serialized, { EX: ttlSeconds });
  }

  async delete(key: string): Promise<boolean> {
    const count = await this.#client.del(this.#key(key));
    return count > 0;
  }

  async clear(): Promise<void> {
    await deleteByPattern(this.#client, `${this.#prefix}*`);
  }

  /** Releases the client this store was given, exactly once. */
  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (this.#closeClient) {
      await closeRedisClient(this.#client);
    }
  }

  /** Releases the client at the end of an `await using` scope. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  #key(key: string): string {
    return `${this.#prefix}${key}`;
  }
}
