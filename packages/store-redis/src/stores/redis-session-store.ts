import type { Session, SessionStore } from "@aponiajs/session";
import { resolveRedisStoreOptions } from "../common/redis-common.ts";
import type { RedisClientInterface, RedisStoreOptions } from "../common/redis.types.ts";

/**
 * Redis-backed session store implementing SessionStore.
 */
export class RedisSessionStore implements SessionStore {
  readonly #client: RedisClientInterface;
  readonly #prefix: string;
  readonly #ttlSeconds: number;

  constructor(options: RedisStoreOptions & { readonly ttlSeconds?: number }) {
    const resolved = resolveRedisStoreOptions(options, "aponia:session:", "RedisSessionStore");
    this.#client = resolved.client;
    this.#prefix = resolved.prefix;
    this.#ttlSeconds = options.ttlSeconds ?? 86400; // 24 hours default
  }

  async get(id: string): Promise<Session | undefined> {
    const raw = await this.#client.get(this.#key(id));
    if (raw === null || raw === undefined) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        return undefined;
      }
      return Object.freeze({ ...parsed });
    } catch {
      return undefined;
    }
  }

  async set(session: Session): Promise<void> {
    const id = session.id;
    const serialized = JSON.stringify(session);
    const ttlSeconds = session.expiresAt
      ? Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000))
      : this.#ttlSeconds;
    await this.#client.set(this.#key(id), serialized, { EX: ttlSeconds });
  }

  async delete(id: string): Promise<boolean> {
    const count = await this.#client.del(this.#key(id));
    return count > 0;
  }

  async clear(): Promise<void> {
    const keys = await this.#client.keys(`${this.#prefix}*`);
    if (keys.length > 0) {
      await this.#client.del(keys);
    }
  }

  #key(id: string): string {
    return `${this.#prefix}${id}`;
  }
}
