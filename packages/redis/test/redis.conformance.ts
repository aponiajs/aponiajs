import { Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  MODULE_OPTIONS_TOKEN,
  REDIS_CLIENT,
  RedisModule,
  RedisService,
  type RedisClientLike,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("registers RedisModule and exposes RedisService", async () => {
  const store = new Map<string, string>();
  const mockClient: RedisClientLike = {
    async ping() {
      return "PONG";
    },
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
      return "OK";
    },
    async del(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      let count = 0;
      for (const k of list) {
        if (store.delete(k)) count += 1;
      }
      return count;
    },
  };

  const def = RedisModule.forRoot({ client: mockClient });
  expect(def.exports).toContain(MODULE_OPTIONS_TOKEN);
  expect(def.exports).toContain(REDIS_CLIENT);

  @Module({
    imports: [def],
  })
  class AppModule {}

  const app = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const service = app.get(RedisService);
    expect(await service.ping()).toBe("PONG");
    await service.cacheStore().set("hello", "world");
    expect(await service.cacheStore().get<string>("hello")).toBe("world");
  } finally {
    await app.close();
  }
});
