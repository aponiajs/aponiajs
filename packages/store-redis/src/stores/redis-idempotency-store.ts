import type { IdempotencyStore, StoredIdempotentResponse } from "@aponiajs/idempotency";
import { deleteByPattern, resolveRedisStoreOptions } from "../common/redis-common.ts";
import type { RedisClientInterface, RedisStoreOptions } from "../common/redis.types.ts";

/**
 * Redis-backed idempotency store implementing IdempotencyStore.
 */
export class RedisIdempotencyStore implements IdempotencyStore {
  readonly #client: RedisClientInterface;
  readonly #prefix: string;

  constructor(options: RedisStoreOptions) {
    const resolved = resolveRedisStoreOptions(
      options,
      "aponia:idempotency:",
      "RedisIdempotencyStore",
    );
    this.#client = resolved.client;
    this.#prefix = resolved.prefix;
  }

  async get(key: string): Promise<StoredIdempotentResponse | undefined> {
    const raw = await this.#client.get(this.#key(key));
    if (raw === null || raw === undefined) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw);
      return Object.freeze({
        status: parsed.status,
        value: parsed.value,
        fingerprint: parsed.fingerprint,
      });
    } catch {
      return undefined;
    }
  }

  async set(key: string, response: StoredIdempotentResponse, ttlMs: number): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    const serialized = JSON.stringify({
      status: response.status,
      value: response.value,
      fingerprint: response.fingerprint,
    });
    await this.#client.set(this.#key(key), serialized, { EX: ttlSeconds });
  }

  async delete(key: string): Promise<boolean> {
    await this.release(key);
    const count = await this.#client.del(this.#key(key));
    return count > 0;
  }

  async claim(key: string, ttlMs: number): Promise<boolean> {
    const result = await this.#client.set(this.#claimKey(key), "1", {
      NX: true,
      PX: ttlMs,
    });
    return result !== null;
  }

  async release(key: string): Promise<void> {
    await this.#client.del(this.#claimKey(key));
  }

  async clear(): Promise<void> {
    await deleteByPattern(this.#client, `${this.#prefix}*`);
  }

  #key(key: string): string {
    return `${this.#prefix}${key}`;
  }

  #claimKey(key: string): string {
    return `${this.#prefix}claim:${key}`;
  }
}
