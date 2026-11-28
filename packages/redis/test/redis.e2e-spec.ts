import { describe, expect, it } from "bun:test";
import { Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { RedisModule, RedisService } from "../src/index.ts";

const redisUrl = process.env.REDIS_URL;

describe("Redis e2e", () => {
  const testFn = redisUrl ? it : it.skip;

  testFn("connects to live Redis and exercises distributed stores", async () => {
    @Module({
      imports: [RedisModule.forRoot({ url: redisUrl, keyPrefix: `e2e:${Date.now()}:` })],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const redis = app.get(RedisService);
      expect(await redis.ping()).toBe("PONG");

      const cache = redis.cacheStore();
      await cache.set("k", { ok: true }, 5_000);
      expect(await cache.get<{ ok: boolean }>("k")).toEqual({ ok: true });
      await cache.clear();

      const lockStore = redis.cronLockStore();
      const lock = await lockStore.acquire("e2e-job", 5_000);
      expect(lock).toBeDefined();
      expect(await lockStore.acquire("e2e-job", 5_000)).toBeUndefined();
      await lock!.release();
    } finally {
      await app.close();
    }
  });
});
