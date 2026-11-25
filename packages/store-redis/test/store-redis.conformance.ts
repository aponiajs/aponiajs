import {
  RedisCacheStore,
  RedisRateLimitStore,
  RedisSessionStore,
  RedisIdempotencyStore,
  RedisRevocationStore,
  RedisRefreshTokenStore,
  type RedisClientInterface,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

const dummyClient: RedisClientInterface = {
  get: async () => null,
  set: async () => "OK",
  del: async () => 0,
  incr: async () => 1,
  expire: async () => true,
  keys: async () => [],
  eval: async () => 1,
};

test("instantiates every Redis store", () => {
  expect(new RedisCacheStore({ client: dummyClient })).toBeDefined();
  expect(new RedisRateLimitStore({ client: dummyClient })).toBeDefined();
  expect(new RedisSessionStore({ client: dummyClient })).toBeDefined();
  expect(new RedisIdempotencyStore({ client: dummyClient })).toBeDefined();
  expect(new RedisRevocationStore({ client: dummyClient })).toBeDefined();
  expect(new RedisRefreshTokenStore({ client: dummyClient })).toBeDefined();
});

test("every store exposes an idempotent close that honors closeClient", async () => {
  let quits = 0;
  const client: RedisClientInterface = {
    ...dummyClient,
    quit: async () => {
      quits += 1;
      return "OK";
    },
  };

  const store = new RedisCacheStore({ client });
  await store.close();
  await store.close();
  await store[Symbol.asyncDispose]();
  expect(quits).toBe(1);

  const owned = new RedisSessionStore({ client, closeClient: false });
  await owned.close();
  expect(quits).toBe(1);
});
