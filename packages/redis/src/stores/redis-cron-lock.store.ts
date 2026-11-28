import { randomUUID } from "node:crypto";
import type { RedisClientLike } from "../interfaces/redis-client.interface.ts";

export interface RedisCronLockHandle {
  release(): Promise<void>;
}

const compareAndDeleteLua = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

/**
 * Redis-backed implementation of `@aponiajs/cron`'s `CronLockStore` using
 * `SET NX PX` with token-checked Lua release.
 */
export class RedisCronLockStore {
  readonly #client: RedisClientLike;
  readonly #prefix: string;

  constructor(client: RedisClientLike, prefix = "aponia:cronlock:") {
    this.#client = client;
    this.#prefix = prefix;
  }

  async acquire(key: string, ttlMs: number): Promise<RedisCronLockHandle | undefined> {
    const fullKey = this.#prefix + key;
    const token = randomUUID();
    const result = await this.#client.set(fullKey, token, { NX: true, PX: ttlMs });
    if (result !== "OK") {
      return undefined;
    }
    const client = this.#client;
    return {
      async release(): Promise<void> {
        if (client.eval !== undefined) {
          await client.eval(compareAndDeleteLua, {
            keys: [fullKey],
            arguments: [token],
          });
          return;
        }
        const current = await client.get(fullKey);
        if (current === token) {
          await client.del(fullKey);
        }
      },
    };
  }
}
