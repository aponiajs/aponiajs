import type { RefreshTokenRecord, RefreshTokenStore } from "@aponiajs/auth";
import type { RevocationStore } from "@aponiajs/auth";
import { deleteByPattern, deleteKeys, resolveRedisStoreOptions } from "../common/redis-common.ts";
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
    await deleteByPattern(this.#client, `${this.#prefix}*`);
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

  async consume(
    idHash: string,
  ): Promise<{ readonly record: RefreshTokenRecord } | { readonly familyId: string } | undefined> {
    // One round trip: read the live record, delete it, and keep a tombstone of
    // its family so a replay can revoke the family instead of only failing.
    const result = await this.#client.eval(
      `local value = redis.call('GET', KEYS[1])
if not value then
  local used = redis.call('GET', KEYS[2])
  if used then return 'used:' .. used end
  return nil
end
local ttl = redis.call('PTTL', KEYS[1])
redis.call('DEL', KEYS[1])
if ttl < 0 then ttl = tonumber(ARGV[1]) end
redis.call('SET', KEYS[2], value, 'PX', ttl)
return 'live:' .. value`,
      {
        keys: [this.#tokenKey(idHash), this.#usedKey(idHash)],
        arguments: ["1"],
      },
    );
    if (typeof result !== "string") {
      return undefined;
    }
    const separator = result.indexOf(":");
    const kind = result.slice(0, separator);
    const serialized = result.slice(separator + 1);
    let parsed: {
      readonly idHash?: unknown;
      readonly userId?: unknown;
      readonly familyId?: unknown;
      readonly createdAt?: unknown;
      readonly expiresAt?: unknown;
    };
    try {
      parsed = JSON.parse(serialized);
    } catch {
      return undefined;
    }
    if (typeof parsed.familyId !== "string") {
      return undefined;
    }
    if (kind === "used") {
      return { familyId: parsed.familyId };
    }
    const record: RefreshTokenRecord = Object.freeze({
      idHash: parsed.idHash as string,
      userId: parsed.userId as string | number,
      familyId: parsed.familyId,
      createdAt: parsed.createdAt as number,
      expiresAt: parsed.expiresAt as number,
    });
    await this.#client.del(`${this.#familyKey(record.familyId)}:${idHash}`);
    return { record };
  }

  async deleteFamily(familyId: string): Promise<number> {
    const familyKey = this.#familyKey(familyId);
    const pattern = `${familyKey}:*`;
    let deletedCount = 0;
    let cursor = "0";
    do {
      const page =
        this.#client.scan === undefined
          ? { cursor: "0", keys: await this.#client.keys(pattern) }
          : await this.#client.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = page.cursor;
      const tokenKeys = page.keys.map((memberKey) =>
        this.#tokenKey(memberKey.slice(familyKey.length + 1)),
      );
      deletedCount += await deleteKeys(this.#client, tokenKeys);
      await deleteKeys(this.#client, page.keys);
    } while (cursor !== "0");
    return deletedCount;
  }

  async clear(): Promise<void> {
    await deleteByPattern(this.#client, `${this.#prefix}*`);
  }

  #usedKey(idHash: string): string {
    return `${this.#prefix}used:${idHash}`;
  }

  #tokenKey(idHash: string): string {
    return `${this.#prefix}token:${idHash}`;
  }

  #familyKey(familyId: string): string {
    return `${this.#prefix}family:${familyId}`;
  }
}
