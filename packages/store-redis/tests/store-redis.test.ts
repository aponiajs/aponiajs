import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import {
  RedisCacheStore,
  RedisRateLimitStore,
  RedisSessionStore,
  RedisIdempotencyStore,
  RedisRevocationStore,
  RedisRefreshTokenStore,
  type RedisClientInterface,
} from "../src/index.ts";

class MockRedisClient implements RedisClientInterface {
  readonly data = new Map<string, { value: string; expiresAt?: number }>();
  scanCalls = 0;
  unlinkCalls = 0;

  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(
    key: string,
    value: string,
    options?: { EX?: number; PX?: number; NX?: boolean; XX?: boolean },
  ): Promise<string | null> {
    if (options?.NX === true && this.data.has(key)) {
      return null;
    }
    if (options?.XX === true && !this.data.has(key)) {
      return null;
    }
    const ttlMs = options?.EX ? options.EX * 1000 : options?.PX;
    const expiresAt = ttlMs ? Date.now() + ttlMs : undefined;
    this.data.set(key, { value, expiresAt });
    return "OK";
  }

  async del(key: string | readonly string[]): Promise<number> {
    const keys = Array.isArray(key) ? key : [key];
    let count = 0;
    for (const k of keys) {
      if (this.data.delete(k)) count++;
    }
    return count;
  }

  async incr(key: string): Promise<number> {
    const current = Number((await this.get(key)) ?? 0);
    const next = current + 1;
    await this.set(key, String(next));
    return next;
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const entry = this.data.get(key);
    if (!entry) return false;
    entry.expiresAt = Date.now() + seconds * 1000;
    return true;
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace("*", "");
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }

  async scan(
    _cursor: string,
    options?: { MATCH?: string; COUNT?: number },
  ): Promise<{ cursor: string; keys: string[] }> {
    this.scanCalls += 1;
    const prefix = (options?.MATCH ?? "*").replace("*", "");
    return {
      cursor: "0",
      keys: [...this.data.keys()].filter((k) => k.startsWith(prefix)),
    };
  }

  async unlink(key: string | readonly string[]): Promise<number> {
    this.unlinkCalls += 1;
    return await this.del(key);
  }

  async eval(
    script: string,
    options?: { keys?: string[]; arguments?: string[] },
  ): Promise<unknown> {
    if (script.includes("live:")) {
      const tokenKey = options?.keys?.[0] ?? "";
      const usedKey = options?.keys?.[1] ?? "";
      const value = await this.get(tokenKey);
      if (value === null) {
        const used = await this.get(usedKey);
        return used === null ? null : `used:${used}`;
      }
      const expiresAt = this.data.get(tokenKey)?.expiresAt;
      await this.del(tokenKey);
      const ttlMs =
        expiresAt === undefined
          ? Number(options?.arguments?.[0] ?? 1)
          : Math.max(1, expiresAt - Date.now());
      this.data.set(usedKey, { value, expiresAt: Date.now() + ttlMs });
      return `live:${value}`;
    }

    const key = options?.keys?.[0] ?? "default";
    const windowMs = Number(options?.arguments?.[0] ?? 60_000);
    const current = Number((await this.get(key)) ?? 0);
    const next = current + 1;
    await this.set(key, String(next), { PX: windowMs });
    return [next, windowMs];
  }
}

describe("RedisStore option validation", () => {
  test("validates store options and rejects invalid configurations", () => {
    const client = new MockRedisClient();
    expect(() => new RedisCacheStore(null as never)).toThrow(AponiaError);
    expect(() => new RedisCacheStore({ client: null as never })).toThrow(AponiaError);
    expect(() => new RedisCacheStore({ client, prefix: 123 as never })).toThrow(AponiaError);
  });
});

describe("RedisCacheStore", () => {
  test("stores, reads, deletes and clears values", async () => {
    const client = new MockRedisClient();
    const store = new RedisCacheStore({ client });

    await store.set("user:1", { name: "Alice" }, 10_000);
    expect(await store.get("user:1")).toEqual({ name: "Alice" });

    // Non-positive TTL deletes
    await store.set("user:1", { name: "Alice" }, 0);
    expect(await store.get("user:1")).toBeUndefined();

    // Invalid JSON returns undefined
    await client.set("aponia:cache:corrupted", "{invalid");
    expect(await store.get("corrupted")).toBeUndefined();

    // Delete existing
    await store.set("user:2", "Bob", 1000);
    expect(await store.delete("user:2")).toBe(true);
    expect(await store.delete("non-existent")).toBe(false);

    // Clear
    await store.set("key1", "val1", 5000);
    await store.set("key2", "val2", 5000);
    await store.clear();
    expect(await store.get("key1")).toBeUndefined();
    expect(await store.get("key2")).toBeUndefined();
    expect(client.scanCalls).toBeGreaterThan(0);
    expect(client.unlinkCalls).toBeGreaterThan(0);
  });
});

describe("RedisRateLimitStore", () => {
  test("increments count atomically within window", async () => {
    const client = new MockRedisClient();
    const store = new RedisRateLimitStore({ client });

    const first = await store.increment("ip:127.0.0.1", 60_000);
    expect(first.count).toBe(1);

    const second = await store.increment("ip:127.0.0.1", 60_000);
    expect(second.count).toBe(2);
    // The second increment must not slide the reported reset forward.
    expect(second.resetAt).toBeLessThanOrEqual(first.resetAt + 1_000);
  });
});

describe("RedisSessionStore", () => {
  test("manages session lifecycle", async () => {
    const client = new MockRedisClient();
    const store = new RedisSessionStore({ client });

    const session = {
      id: "sess-1",
      data: { userId: "user-42" },
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600_000,
    };
    await store.set(session);

    const fetched = await store.get("sess-1");
    expect(fetched).toEqual(session);

    // Invalid JSON returns undefined
    await client.set("aponia:session:corrupted", "{invalid");
    expect(await store.get("corrupted")).toBeUndefined();

    // Non-object JSON returns undefined
    await client.set("aponia:session:primitive", "42");
    expect(await store.get("primitive")).toBeUndefined();

    // Session without expiresAt
    await store.set({ id: "sess-2", data: {}, createdAt: Date.now(), expiresAt: 0 });
    expect(await store.get("sess-2")).toBeDefined();

    expect(await store.delete("sess-1")).toBe(true);
    expect(await store.delete("non-existent")).toBe(false);
    expect(await store.get("sess-1")).toBeUndefined();

    await store.clear();
  });
});

describe("RedisIdempotencyStore", () => {
  test("stores and matches idempotent responses", async () => {
    const client = new MockRedisClient();
    const store = new RedisIdempotencyStore({ client });

    const resp = { status: 201, value: { id: "res-1" }, fingerprint: "fp-123" };
    await store.set("idem-key", resp, 60_000);

    const fetched = await store.get("idem-key");
    expect(fetched).toEqual(resp);

    // Invalid JSON
    await client.set("aponia:idempotency:corrupted", "{invalid");
    expect(await store.get("corrupted")).toBeUndefined();

    expect(await store.delete("idem-key")).toBe(true);
    expect(await store.get("idem-key")).toBeUndefined();

    await store.set("k1", resp, 5000);
    await store.clear();
    expect(await store.get("k1")).toBeUndefined();
  });

  test("claims one key atomically and releases it", async () => {
    const client = new MockRedisClient();
    const store = new RedisIdempotencyStore({ client });

    expect(await store.claim("key", 60_000)).toBe(true);
    expect(await store.claim("key", 60_000)).toBe(false);
    expect(client.data.has("aponia:idempotency:claim:key")).toBe(true);

    await store.release("key");
    expect(await store.claim("key", 60_000)).toBe(true);

    await store.delete("key");
    expect(client.data.has("aponia:idempotency:claim:key")).toBe(false);

    await store.claim("clear-key", 60_000);
    await store.clear();
    expect(client.data.has("aponia:idempotency:claim:clear-key")).toBe(false);
  });
});

describe("RedisRevocationStore & RedisRefreshTokenStore", () => {
  test("tracks revoked jti tokens", async () => {
    const client = new MockRedisClient();
    const revStore = new RedisRevocationStore({ client });

    expect(await revStore.isRevoked("jti-1")).toBe(false);
    await revStore.revoke("jti-1", Date.now() + 60_000);
    expect(await revStore.isRevoked("jti-1")).toBe(true);

    // Expired immediately
    await revStore.revoke("jti-2", Date.now() - 1000);
    expect(await revStore.isRevoked("jti-2")).toBe(false);

    await revStore.clear();
    expect(await revStore.isRevoked("jti-1")).toBe(false);
  });

  test("manages refresh token records and families", async () => {
    const client = new MockRedisClient();
    const refreshStore = new RedisRefreshTokenStore({ client });

    const record = {
      idHash: "hash-1",
      userId: "u1",
      familyId: "fam-1",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };

    await refreshStore.create(record);
    expect(await refreshStore.find("hash-1")).toEqual(record);

    // Invalid JSON
    await client.set("aponia:refresh-token:token:corrupted", "{invalid");
    expect(await refreshStore.find("corrupted")).toBeUndefined();

    // Delete single token
    expect(await refreshStore.delete("hash-1")).toBe(true);
    expect(await refreshStore.find("hash-1")).toBeUndefined();

    // Create another and deleteFamily
    await refreshStore.create(record);
    const deleted = await refreshStore.deleteFamily("fam-1");
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await refreshStore.find("hash-1")).toBeUndefined();

    await refreshStore.clear();
  });

  test("consumes a refresh token once and answers its family on reuse", async () => {
    const client = new MockRedisClient();
    const refreshStore = new RedisRefreshTokenStore({ client });
    const record = {
      idHash: "hash-consume",
      userId: "u1",
      familyId: "fam-consume",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    await refreshStore.create(record);

    expect(await refreshStore.consume("hash-consume")).toEqual({ record });
    expect(await refreshStore.consume("hash-consume")).toEqual({ familyId: "fam-consume" });
    expect(await refreshStore.find("hash-consume")).toBeUndefined();
    expect(await refreshStore.consume("missing")).toBeUndefined();

    await refreshStore.clear();
  });
});
