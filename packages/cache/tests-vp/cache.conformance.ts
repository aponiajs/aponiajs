import { Module, type Token } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  CACHE_STORE,
  CacheModule,
  CacheService,
  MemoryCacheStore,
  type CacheModuleOptions,
  type CacheStore,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("exposes the documented options and store contracts", () => {
  const options: CacheModuleOptions = {
    ttlMs: 1_000,
    maxEntries: 10,
    keyPrefix: "test:",
    store: new MemoryCacheStore(),
  };
  const store: CacheStore = new MemoryCacheStore();
  const storeToken: Token<CacheStore> = CACHE_STORE;
  const serviceToken: Token<CacheService> = CacheService;

  expect(options.ttlMs).toBe(1_000);
  expect(store).toBeInstanceOf(MemoryCacheStore);
  expect(storeToken).toBe(CACHE_STORE);
  expect(serviceToken).toBe(CacheService);
});

test("boots and answers through the injected service", async () => {
  @Module({ imports: [CacheModule.register({ keyPrefix: "vp:" })] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const cache = application.get(CacheService);
    await cache.set("key", "value");

    expect(await cache.get<string>("key")).toBe("value");
  } finally {
    await application.close();
  }
});

test("shares one factory run between concurrent misses", async () => {
  @Module({ imports: [CacheModule.register()] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const cache = application.get(CacheService);
    let calls = 0;
    let release: (() => void) | undefined;
    const factory = (): Promise<string> => {
      calls += 1;
      return new Promise<string>((resolve) => {
        release = () => resolve("value");
      });
    };

    const first = cache.wrap("key", factory);
    while (calls === 0) {
      await Promise.resolve();
    }
    const second = cache.wrap("key", factory);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1);

    release?.();
    expect(await first).toBe("value");
    expect(await second).toBe("value");
    expect(await cache.get<string>("key")).toBe("value");
  } finally {
    await application.close();
  }
});
