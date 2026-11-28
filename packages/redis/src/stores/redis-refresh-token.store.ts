import type { RedisClientLike } from "../interfaces/redis-client.interface.ts";
import { deleteByPrefix } from "./redis-cache.store.ts";

export interface RedisRefreshTokenRecord {
  readonly idHash: string;
  readonly userId: string | number;
  readonly familyId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export type RedisRefreshTokenConsumeResult =
  | { readonly record: RedisRefreshTokenRecord }
  | { readonly familyId: string };

interface StoredTokenEntry {
  readonly consumed: boolean;
  readonly familyId: string;
  readonly record?: RedisRefreshTokenRecord;
}

/**
 * Redis-backed implementation of `@aponiajs/auth`'s `RefreshTokenStore`,
 * supporting `consume(idHash)` reuse detection and `deleteFamily(familyId)`.
 */
export class RedisRefreshTokenStore {
  readonly #client: RedisClientLike;
  readonly #prefix: string;
  readonly #now: () => number;

  constructor(client: RedisClientLike, prefix = "aponia:rt:", now: () => number = Date.now) {
    this.#client = client;
    this.#prefix = prefix;
    this.#now = now;
  }

  async create(record: RedisRefreshTokenRecord): Promise<void> {
    const ttlMs = Math.max(1, record.expiresAt - this.#now());
    const entry: StoredTokenEntry = {
      consumed: false,
      familyId: record.familyId,
      record,
    };
    await this.#client.set(this.#tokenKey(record.idHash), JSON.stringify(entry), { PX: ttlMs });
    if (this.#client.sAdd !== undefined) {
      const familyKey = this.#familyKey(record.familyId);
      await this.#client.sAdd(familyKey, record.idHash);
      if (this.#client.pExpire !== undefined) {
        await this.#client.pExpire(familyKey, ttlMs);
      }
    }
  }

  async find(idHash: string): Promise<RedisRefreshTokenRecord | undefined> {
    const raw = await this.#client.get(this.#tokenKey(idHash));
    if (raw === null) {
      return undefined;
    }
    const entry = JSON.parse(raw) as StoredTokenEntry;
    if (entry.consumed || entry.record === undefined) {
      return undefined;
    }
    return entry.record;
  }

  async consume(idHash: string): Promise<RedisRefreshTokenConsumeResult | undefined> {
    const raw = await this.#client.get(this.#tokenKey(idHash));
    if (raw === null) {
      return undefined;
    }
    const entry = JSON.parse(raw) as StoredTokenEntry;
    if (entry.consumed || entry.record === undefined) {
      return { familyId: entry.familyId };
    }
    const ttlMs = Math.max(1, entry.record.expiresAt - this.#now());
    const tombstone: StoredTokenEntry = {
      consumed: true,
      familyId: entry.familyId,
    };
    await this.#client.set(this.#tokenKey(idHash), JSON.stringify(tombstone), { PX: ttlMs });
    return { record: entry.record };
  }

  async delete(idHash: string): Promise<boolean> {
    const deleted = await this.#client.del(this.#tokenKey(idHash));
    return deleted > 0;
  }

  async deleteFamily(familyId: string): Promise<number> {
    if (this.#client.sMembers === undefined) {
      return 0;
    }
    const familyKey = this.#familyKey(familyId);
    const members = await this.#client.sMembers(familyKey);
    let removed = 0;
    if (members.length > 0) {
      removed = await this.#client.del(members.map((idHash) => this.#tokenKey(idHash)));
    }
    await this.#client.del(familyKey);
    return removed;
  }

  async clear(): Promise<void> {
    await deleteByPrefix(this.#client, this.#prefix);
  }

  #tokenKey(idHash: string): string {
    return `${this.#prefix}tok:${idHash}`;
  }

  #familyKey(familyId: string): string {
    return `${this.#prefix}fam:${familyId}`;
  }
}
