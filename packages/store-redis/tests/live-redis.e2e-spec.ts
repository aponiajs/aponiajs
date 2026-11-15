import { expect, test } from "bun:test";
import { createClient } from "redis";
import { RedisCacheStore, RedisRateLimitStore, type RedisClientInterface } from "../src/index.ts";

const enabled = process.env.APONIA_REDIS_E2E === "1";

test.skipIf(!enabled)("Redis stores round-trip against a live server", async () => {
  const client = createClient({
    url: process.env.APONIA_REDIS_URL ?? "redis://localhost:6379",
  });
  await client.connect();

  try {
    const storeClient = client as unknown as RedisClientInterface;
    const cache = new RedisCacheStore({ client: storeClient, prefix: "aponia:e2e:cache:" });

    await cache.set("key", { value: 1 }, 5_000);
    expect(await cache.get("key")).toEqual({ value: 1 });
    expect(await cache.delete("key")).toBe(true);
    expect(await cache.get("key")).toBeUndefined();

    const rate = new RedisRateLimitStore({ client: storeClient, prefix: "aponia:e2e:rate:" });
    const first = await rate.increment("client", 5_000);
    const second = await rate.increment("client", 5_000);

    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(second.resetAt).toBeGreaterThanOrEqual(first.resetAt);
  } finally {
    await client.quit();
  }
});
