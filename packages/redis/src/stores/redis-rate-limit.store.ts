import type { RedisClientLike } from "../interfaces/redis-client.interface.ts";

const incrementLua = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[1]))
end
local pttl = redis.call("PTTL", KEYS[1])
return { current, pttl }
`;

/** Redis-backed implementation of `@aponiajs/rate-limit`'s `RateLimitStore`. */
export class RedisRateLimitStore {
  readonly #client: RedisClientLike;
  readonly #prefix: string;
  readonly #now: () => number;

  constructor(client: RedisClientLike, prefix = "aponia:rl:", now: () => number = Date.now) {
    this.#client = client;
    this.#prefix = prefix;
    this.#now = now;
  }

  async increment(
    key: string,
    windowMs: number,
  ): Promise<{ readonly count: number; readonly resetAt: number }> {
    const fullKey = this.#prefix + key;
    if (this.#client.eval !== undefined) {
      const result = (await this.#client.eval(incrementLua, {
        keys: [fullKey],
        arguments: [String(windowMs)],
      })) as [number, number];
      const count = Number(result[0]);
      const pttl = Number(result[1]);
      return {
        count,
        resetAt: this.#now() + (pttl > 0 ? pttl : windowMs),
      };
    }

    const raw = await this.#client.get(fullKey);
    const next = (raw === null ? 0 : Number(raw)) + 1;
    await this.#client.set(fullKey, String(next), { PX: windowMs });
    return { count: next, resetAt: this.#now() + windowMs };
  }
}
