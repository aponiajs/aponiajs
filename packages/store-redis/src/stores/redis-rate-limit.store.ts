import type { RateLimitStore } from "@aponiajs/rate-limit";
import { closeRedisClient, resolveRedisStoreOptions } from "../common/redis-common.ts";
import type { RedisClientInterface, RedisStoreOptions } from "../interfaces/redis.interface.ts";

/**
 * Redis-backed rate-limit store implementing RateLimitStore.
 */
export class RedisRateLimitStore implements RateLimitStore {
  readonly #client: RedisClientInterface;
  readonly #prefix: string;
  readonly #closeClient: boolean;
  #closed = false;

  constructor(options: RedisStoreOptions) {
    const resolved = resolveRedisStoreOptions(options, "aponia:rate-limit:", "RedisRateLimitStore");
    this.#client = resolved.client;
    this.#prefix = resolved.prefix;
    this.#closeClient = resolved.closeClient;
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const fullKey = `${this.#prefix}${key}`;

    // One round trip: increment, set the window on the first hit, and read the
    // live TTL. The reported reset must not slide forward on every increment.
    const script = `
      local current = redis.call('INCR', KEYS[1])
      local ttl = redis.call('PTTL', KEYS[1])
      if ttl < 0 then
        redis.call('PEXPIRE', KEYS[1], ARGV[1])
        ttl = tonumber(ARGV[1])
      end
      return {current, ttl}
    `;

    const result = await this.#client.eval(script, {
      keys: [fullKey],
      arguments: [String(windowMs)],
    });
    const tuple = Array.isArray(result) ? result : [result, windowMs];
    const count = Number(tuple[0]);
    const ttlMs = Number(tuple[1]);
    const now = Date.now();

    return { count, resetAt: now + (Number.isFinite(ttlMs) ? ttlMs : windowMs) };
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
}
