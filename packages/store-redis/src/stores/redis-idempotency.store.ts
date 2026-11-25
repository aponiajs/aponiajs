import type { IdempotencyStore, StoredIdempotentResponse } from "@aponiajs/idempotency";
import {
  deleteByPattern,
  closeRedisClient,
  resolveRedisStoreOptions,
} from "../common/redis-common.ts";
import type { RedisClientInterface, RedisStoreOptions } from "../interfaces/redis.interface.ts";

/**
 * Redis-backed idempotency store implementing IdempotencyStore.
 */
export class RedisIdempotencyStore implements IdempotencyStore {
  readonly #client: RedisClientInterface;
  readonly #prefix: string;
  readonly #closeClient: boolean;
  #closed = false;

  constructor(options: RedisStoreOptions) {
    const resolved = resolveRedisStoreOptions(
      options,
      "aponia:idempotency:",
      "RedisIdempotencyStore",
    );
    this.#client = resolved.client;
    this.#prefix = resolved.prefix;
    this.#closeClient = resolved.closeClient;
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
    return `${this.#prefix}response:${encodeKey(key)}`;
  }

  #claimKey(key: string): string {
    return `${this.#prefix}claim:${encodeKey(key)}`;
  }
}

/**
 * Encodes one caller-supplied key into an internal Redis key segment.
 *
 * A raw key must not be able to spell another record's internal name, so the
 * separator and every other reserved character are percent-encoded.
 */
function encodeKey(key: string): string {
  return encodeURIComponent(key);
}
