import type { RedisClientLike } from "../interfaces/redis-client.interface.ts";
import { deleteByPrefix } from "./redis-cache.store.ts";

export interface RedisSessionRecord<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly id: string;
  readonly data: TData;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** Redis-backed implementation of `@aponiajs/session`'s `SessionStore`. */
export class RedisSessionStore {
  readonly #client: RedisClientLike;
  readonly #prefix: string;
  readonly #now: () => number;

  constructor(client: RedisClientLike, prefix = "aponia:sess:", now: () => number = Date.now) {
    this.#client = client;
    this.#prefix = prefix;
    this.#now = now;
  }

  async get(id: string): Promise<RedisSessionRecord | undefined> {
    const raw = await this.#client.get(this.#prefix + id);
    if (raw === null) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as RedisSessionRecord;
    if (parsed.expiresAt <= this.#now()) {
      await this.delete(id);
      return undefined;
    }
    return parsed;
  }

  async set(session: RedisSessionRecord): Promise<void> {
    const ttlMs = Math.max(1, session.expiresAt - this.#now());
    await this.#client.set(this.#prefix + session.id, JSON.stringify(session), { PX: ttlMs });
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.#client.del(this.#prefix + id);
    return deleted > 0;
  }

  async clear(): Promise<void> {
    await deleteByPrefix(this.#client, this.#prefix);
  }
}
