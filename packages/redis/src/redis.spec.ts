import { describe, expect, it } from "bun:test";
import { Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  RedisCacheStore,
  RedisCronLockStore,
  RedisIdempotencyStore,
  RedisModule,
  RedisRateLimitStore,
  RedisRefreshTokenStore,
  RedisRevocationStore,
  RedisService,
  RedisSessionStore,
  type RedisClientLike,
  type RedisSetOptions,
} from "./index.ts";

class InMemoryMockRedis implements RedisClientLike {
  readonly data = new Map<string, { value: string; expiresAt?: number }>();
  readonly sets = new Map<string, Set<string>>();
  quitCalls = 0;

  async ping(): Promise<string> {
    return "PONG";
  }

  async quit(): Promise<void> {
    this.quitCalls += 1;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (entry === undefined) {
      return null;
    }
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, options?: RedisSetOptions): Promise<string | null> {
    if (options?.NX === true && (await this.get(key)) !== null) {
      return null;
    }
    this.data.set(key, {
      value,
      expiresAt: options?.PX !== undefined ? Date.now() + options.PX : undefined,
    });
    return "OK";
  }

  async del(keys: string | readonly string[]): Promise<number> {
    const list = Array.isArray(keys) ? keys : [keys];
    let removed = 0;
    for (const key of list) {
      if (this.data.delete(key)) {
        removed += 1;
      }
      if (this.sets.delete(key)) {
        removed += 1;
      }
    }
    return removed;
  }

  async sAdd(key: string, members: string | readonly string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    const list = Array.isArray(members) ? members : [members];
    let added = 0;
    for (const m of list) {
      if (!set.has(m)) {
        set.add(m);
        added += 1;
      }
    }
    this.sets.set(key, set);
    return added;
  }

  async sMembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }

  async pExpire(): Promise<number> {
    return 1;
  }

  async scan(
    _cursor: string | number,
    options?: { readonly MATCH?: string },
  ): Promise<{ readonly cursor: string; readonly keys: readonly string[] }> {
    const pattern = (options?.MATCH ?? "*").replace(/\*$/, "");
    const keys = [...this.data.keys()].filter((k) => k.startsWith(pattern));
    return { cursor: "0", keys };
  }
}

describe("RedisModule & Distributed Stores", () => {
  it("boots RedisModule with injected client and builds all 7 distributed stores", async () => {
    const mock = new InMemoryMockRedis();

    @Module({
      imports: [RedisModule.forRoot({ client: mock, keyPrefix: "test:" })],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const redis = app.get(RedisService);
      expect(redis.client).toBe(mock);
      expect(await redis.ping()).toBe("PONG");
      expect(redis.cacheStore()).toBeInstanceOf(RedisCacheStore);
      expect(redis.rateLimitStore()).toBeInstanceOf(RedisRateLimitStore);
      expect(redis.sessionStore()).toBeInstanceOf(RedisSessionStore);
      expect(redis.refreshTokenStore()).toBeInstanceOf(RedisRefreshTokenStore);
      expect(redis.revocationStore()).toBeInstanceOf(RedisRevocationStore);
      expect(redis.idempotencyStore()).toBeInstanceOf(RedisIdempotencyStore);
      expect(redis.cronLockStore()).toBeInstanceOf(RedisCronLockStore);
    } finally {
      await app.close();
    }
    // Caller-injected client is never closed by RedisModule.
    expect(mock.quitCalls).toBe(0);
  });

  it("supports cache, rate-limit, session, revocation, refresh-token, idempotency, and cron lock stores", async () => {
    const mock = new InMemoryMockRedis();

    const cache = new RedisCacheStore(mock);
    await cache.set("k1", { ok: true }, 5_000);
    expect(await cache.get<{ ok: boolean }>("k1")).toEqual({ ok: true });
    expect(await cache.delete("k1")).toBe(true);
    expect(await cache.get("k1")).toBeUndefined();
    await cache.set("k2", "v2");
    await cache.clear();
    expect(await cache.get("k2")).toBeUndefined();

    const rl = new RedisRateLimitStore(mock);
    const firstRl = await rl.increment("ip:1", 10_000);
    const secondRl = await rl.increment("ip:1", 10_000);
    expect(firstRl.count).toBe(1);
    expect(secondRl.count).toBe(2);

    const sessionStore = new RedisSessionStore(mock);
    const now = Date.now();
    await sessionStore.set({ id: "s1", data: { user: 1 }, createdAt: now, expiresAt: now + 5_000 });
    expect((await sessionStore.get("s1"))?.data).toEqual({ user: 1 });
    expect(await sessionStore.delete("s1")).toBe(true);
    await sessionStore.set({ id: "s2", data: {}, createdAt: now, expiresAt: now - 10 });
    expect(await sessionStore.get("s2")).toBeUndefined();

    const revStore = new RedisRevocationStore(mock);
    expect(await revStore.isRevoked("jti-1")).toBe(false);
    await revStore.revoke("jti-1", now + 5_000);
    expect(await revStore.isRevoked("jti-1")).toBe(true);
    await revStore.clear();

    const rtStore = new RedisRefreshTokenStore(mock);
    await rtStore.create({
      idHash: "h1",
      userId: 1,
      familyId: "fam-1",
      createdAt: now,
      expiresAt: now + 5_000,
    });
    expect((await rtStore.find("h1"))?.userId).toBe(1);
    expect(await rtStore.consume("h1")).toEqual({
      record: {
        idHash: "h1",
        userId: 1,
        familyId: "fam-1",
        createdAt: now,
        expiresAt: now + 5_000,
      },
    });
    expect(await rtStore.consume("h1")).toEqual({ familyId: "fam-1" });
    expect(await rtStore.deleteFamily("fam-1")).toBe(1);

    const idemStore = new RedisIdempotencyStore(mock);
    expect(await idemStore.acquire("k1", 5_000, "hash-1")).toEqual({ state: "acquired" });
    expect(await idemStore.acquire("k1", 5_000, "hash-1")).toEqual({ state: "in_flight" });
    await idemStore.complete(
      "k1",
      { statusCode: 200, headers: {}, body: "ok", requestHash: "hash-1", expiresAt: now + 5_000 },
      5_000,
    );
    expect(await idemStore.acquire("k1", 5_000, "hash-1")).toEqual({
      state: "completed",
      record: {
        statusCode: 200,
        headers: {},
        body: "ok",
        requestHash: "hash-1",
        expiresAt: now + 5_000,
      },
    });
    await idemStore.release("k1");
    expect(await idemStore.acquire("k1", 5_000, "hash-1")).toEqual({ state: "acquired" });

    const lockStore = new RedisCronLockStore(mock);
    const lock1 = await lockStore.acquire("job-a", 5_000);
    expect(lock1).toBeDefined();
    expect(await lockStore.acquire("job-a", 5_000)).toBeUndefined();
    await lock1!.release();
    const lock2 = await lockStore.acquire("job-a", 5_000);
    expect(lock2).toBeDefined();
    await lock2!.release();
  });

  it("validates options and supports forRootAsync", async () => {
    expect(() => RedisModule.forRoot({})).toThrow();
    expect(() => RedisModule.forRoot({ url: "   " })).toThrow();

    const mock = new InMemoryMockRedis();
    @Module({
      imports: [
        RedisModule.forRootAsync({
          useFactory: async () => ({ client: mock }),
        }),
      ],
    })
    class AsyncModule {}

    const app = await AponiaFactory.create(AsyncModule, { logger: false });
    try {
      expect(await app.get(RedisService).ping()).toBe("PONG");
    } finally {
      await app.close();
    }

    // Exercise eval Lua paths, clear/delete edge cases, and owned client shutdown
    const evalClient: RedisClientLike = {
      async get() {
        return null;
      },
      async set() {
        return "OK";
      },
      async del() {
        return 1;
      },
      async eval(_script, opts) {
        if (opts.keys[0]?.includes("rl:")) return [1, 5_000];
        return 1;
      },
      async quit() {
        mock.quitCalls += 1;
      },
    };
    const ownedService = new RedisService(evalClient, "app:", true);
    expect(await ownedService.ping()).toBe("PONG");
    expect((await ownedService.rateLimitStore().increment("k", 5_000)).count).toBe(1);
    const evalLock = await ownedService.cronLockStore().acquire("job", 5_000);
    await evalLock!.release();
    await ownedService.sessionStore().clear();
    const rt = ownedService.refreshTokenStore();
    expect(await rt.find("missing")).toBeUndefined();
    expect(await rt.consume("missing")).toBeUndefined();
    expect(await rt.delete("missing")).toBe(true);
    expect(await rt.deleteFamily("missing")).toBe(0);
    await rt.clear();
    await ownedService.onModuleDestroy();
    expect(mock.quitCalls).toBe(1);
  });
});
