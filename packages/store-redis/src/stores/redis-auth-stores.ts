import type { RefreshTokenRecord, RefreshTokenStore } from "@aponiajs/auth";
import type { RevocationStore } from "@aponiajs/auth";
import { resolveRedisStoreOptions } from "../common/redis-common.ts";
import type { RedisClientInterface, RedisStoreOptions } from "../common/redis.types.ts";

/**
 * Redis-backed revocation store implementing RevocationStore.
 */
export class RedisRevocationStore implements RevocationStore {
  readonly #client: RedisClientInterface;
  readonly #prefix: string;

  constructor(options: RedisStoreOptions) {
    const resolved = resolveRedisStoreOptions(
      options,
      "aponia:revocation:",
      "RedisRevocationStore",
    );
    this.#client = resolved.client;
    this.#prefix = resolved.prefix;
  }

  async revoke(jti: string, expiresAt: number): Promise<void> {
    const ttlMs = expiresAt - Date.now();
    if (ttlMs <= 0) {
      return;
    }
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    await this.#client.set(this.#key(jti), "1", { EX: ttlSeconds });
  }

  async isRevoked(jti: string): Promise<boolean> {
    const val = await this.#client.get(this.#key(jti));
    return val !== null && val !== undefined;
  }

  async clear(): Promise<void> {
    const keys = await this.#client.keys(`${this.#prefix}*`);
    if (keys.length > 0) {
      await this.#client.del(keys);
    }
  }

  #key(jti: string): string {
    return `${this.#prefix}${jti}`;
  }
}

/**
 * Redis-backed refresh token store implementing RefreshTokenStore.
 */
export class RedisRefreshTokenStore implements RefreshTokenStore {
  readonly #client: RedisClientInterface;
  readonly #prefix: string;

  constructor(options: RedisStoreOptions) {
    const resolved = resolveRedisStoreOptions(
      options,
      "aponia:refresh-token:",
      "RedisRefreshTokenStore",
    );
    this.#client = resolved.client;
    this.#prefix = resolved.prefix;
  }

  async create(record: RefreshTokenRecord): Promise<void> {
    const ttlMs = record.expiresAt - Date.now();
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    const serialized = JSON.stringify(record);

    await this.#client.set(this.#tokenKey(record.idHash), serialized, { EX: ttlSeconds });

    // Track family association
    const familyKey = this.#familyKey(record.familyId);
    await this.#client.set(`${familyKey}:${record.idHash}`, "1", { EX: ttlSeconds });
  }

  async find(idHash: string): Promise<RefreshTokenRecord | undefined> {
    const raw = await this.#client.get(this.#tokenKey(idHash));
    if (raw === null || raw === undefined) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw);
      return Object.freeze({
        idHash: parsed.idHash,
        userId: parsed.userId,
        familyId: parsed.familyId,
        createdAt: parsed.createdAt,
        expiresAt: parsed.expiresAt,
      });
    } catch {
      return undefined;
    }
  }

  async delete(idHash: string): Promise<boolean> {
    const record = await this.find(idHash);
    if (record !== undefined) {
      await this.#client.del(`${this.#familyKey(record.familyId)}:${idHash}`);
    }
    const count = await this.#client.del(this.#tokenKey(idHash));
    return count > 0;
  }

  async deleteFamily(familyId: string): Promise<number> {
    const familyKey = this.#familyKey(familyId);
    const keys = await this.#client.keys(`${familyKey}:*`);
    let deletedCount = 0;
    for (const memberKey of keys) {
      const idHash = memberKey.slice(familyKey.length + 1);
      const deleted = await this.#client.del(this.#tokenKey(idHash));
      await this.#client.del(memberKey);
      if (deleted > 0) {
        deletedCount += deleted;
      }
    }
    return deletedCount;
  }

  async clear(): Promise<void> {
    const keys = await this.#client.keys(`${this.#prefix}*`);
    if (keys.length > 0) {
      await this.#client.del(keys);
    }
  }

  #tokenKey(idHash: string): string {
    return `${this.#prefix}token:${idHash}`;
  }

  #familyKey(familyId: string): string {
    return `${this.#prefix}family:${familyId}`;
  }
}
