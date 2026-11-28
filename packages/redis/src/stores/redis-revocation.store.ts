import type { RedisClientLike } from "../interfaces/redis-client.interface.ts";
import { deleteByPrefix } from "./redis-cache.store.ts";

/** Redis-backed implementation of `@aponiajs/auth`'s `RevocationStore`. */
export class RedisRevocationStore {
  readonly #client: RedisClientLike;
  readonly #prefix: string;
  readonly #now: () => number;

  constructor(client: RedisClientLike, prefix = "aponia:rev:", now: () => number = Date.now) {
    this.#client = client;
    this.#prefix = prefix;
    this.#now = now;
  }

  async revoke(jti: string, expiresAt: number): Promise<void> {
    const ttlMs = Math.max(1, expiresAt - this.#now());
    await this.#client.set(this.#prefix + jti, "1", { PX: ttlMs });
  }

  async isRevoked(jti: string): Promise<boolean> {
    const value = await this.#client.get(this.#prefix + jti);
    return value !== null;
  }

  async clear(): Promise<void> {
    await deleteByPrefix(this.#client, this.#prefix);
  }
}
