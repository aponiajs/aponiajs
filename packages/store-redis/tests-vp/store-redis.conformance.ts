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
