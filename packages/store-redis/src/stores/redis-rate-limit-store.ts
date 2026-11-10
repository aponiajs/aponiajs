import type { RateLimitStore } from "@aponiajs/rate-limit";
import { resolveRedisStoreOptions } from "../common/redis-common.ts";
import type { RedisClientInterface, RedisStoreOptions } from "../common/redis.types.ts";

/**
 * Redis-backed rate-limit store implementing RateLimitStore.
 */
export class RedisRateLimitStore implements RateLimitStore {
  readonly #client: RedisClientInterface;
  readonly #prefix: string;

  constructor(options: RedisStoreOptions) {
    const resolved = resolveRedisStoreOptions(options, "aponia:rate-limit:", "RedisRateLimitStore");
    this.#client = resolved.client;
    this.#prefix = resolved.prefix;
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const fullKey = `${this.#prefix}${key}`;
    const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));

    // Atomic INCR + EXPIRE on first increment via Redis Lua script
    const script = `
      local current = redis.call('INCR', KEYS[1])
      if current == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
      end
      return current
    `;

    const countResult = await this.#client.eval(script, {
      keys: [fullKey],
      arguments: [String(windowSeconds)],
    });

    const count = Number(countResult);
    const now = Date.now();
    const resetAt = now + windowMs;

    return { count, resetAt };
  }
}
