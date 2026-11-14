import { afterEach, describe, expect, test } from "bun:test";
import { AponiaError, Module, createToken, provideFactory } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { CACHE_STORE, CacheModule, CacheService, type CacheStore } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("CacheModule", () => {
  test("boots one service that reads and writes through the registration", async () => {
    @Module({ imports: [CacheModule.register({ keyPrefix: "app:", ttlMs: 1_000 })] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const cache = application.get(CacheService);

    await cache.set("key", "value");

    expect(await cache.get<string>("key")).toBe("value");
    expect(application.get(CACHE_STORE)).toBe(application.get(CACHE_STORE));
  });

  test("does not store undefined and deletes an existing entry", async () => {
    @Module({ imports: [CacheModule.register()] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const cache = application.get(CacheService);

    await cache.set("key", "value");
    await cache.set("key", undefined);

    expect(await cache.get("key")).toBeUndefined();
  });

  test("deletes, clears, and removes an entry for a non-positive TTL", async () => {
    @Module({ imports: [CacheModule.register()] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const cache = application.get(CacheService);
    await cache.set("key", "value");

    expect(await cache.delete("key")).toBe(true);
    await cache.set("key", "value");
    await cache.set("key", "value", { ttlMs: 0 });
    expect(await cache.get("key")).toBeUndefined();

    await cache.set("key", "value");
    await cache.clear();
    expect(await cache.get("key")).toBeUndefined();
  });

  test("wrap computes once and reuses the stored value", async () => {
    @Module({ imports: [CacheModule.register()] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const cache = application.get(CacheService);
    let calls = 0;

    const first = await cache.wrap("key", () => {
      calls += 1;
      return "value";
    });
    const second = await cache.wrap("key", () => {
      calls += 1;
      return "other";
    });

    expect(first).toBe("value");
    expect(second).toBe("value");
    expect(calls).toBe(1);
  });

  test("does not cache an undefined factory result", async () => {
    @Module({ imports: [CacheModule.register()] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const cache = application.get(CacheService);
    let calls = 0;

    const first = await cache.wrap("key", () => {
      calls += 1;
      return undefined;
    });
    const second = await cache.wrap("key", () => {
      calls += 1;
      return "value";
    });

    expect(first).toBeUndefined();
    expect(second).toBe("value");
    expect(calls).toBe(2);
  });

  test("shares one factory run between concurrent misses", async () => {
    @Module({ imports: [CacheModule.register()] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
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
  });

  test("shares a rejection without caching it and retries on the next call", async () => {
    @Module({ imports: [CacheModule.register()] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const cache = application.get(CacheService);
    let calls = 0;
    const failing = async (): Promise<string> => {
      calls += 1;
      await Bun.sleep(0);
      throw new Error("origin down");
    };

    const settled = await Promise.allSettled([
      cache.wrap("key", failing),
      cache.wrap("key", failing),
    ]);

    expect(calls).toBe(1);
    expect(settled.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(await cache.wrap("key", () => "recovered")).toBe("recovered");
    expect(await cache.get<string>("key")).toBe("recovered");
  });

  test("accepts a synchronous custom store", async () => {
    const entries = new Map<string, unknown>();
    const store: CacheStore = {
      get<T>(key: string): T | undefined {
        return entries.get(key) as T | undefined;
      },
      set<T>(key: string, value: T): void {
        entries.set(key, value);
      },
      delete(key: string): boolean {
        return entries.delete(key);
      },
      clear(): void {
        entries.clear();
      },
    };

    @Module({ imports: [CacheModule.register({ store, keyPrefix: "custom:" })] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const cache = application.get(CacheService);
    await cache.set("key", "value");

    expect(entries.get("custom:key")).toBe("value");
    expect(await cache.get<string>("key")).toBe("value");
  });

  test("reports every invalid option in one boot-time refusal", () => {
    const error = captureAponiaError(() =>
      CacheModule.register({ ttlMs: 0, maxEntries: 0, keyPrefix: 1 as never }),
    );

    expect(error.code).toBe("INVALID_CONFIGURATION_VALUE");
    expect(error.details).toEqual({
      configuration: "cache",
      issues: [
        "ttlMs must be a positive finite number",
        "maxEntries must be a positive integer",
        "keyPrefix must be a string",
      ],
    });
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  test("keeps two registrations distinct", async () => {
    const first = CacheModule.register({ keyPrefix: "first:" });
    const second = CacheModule.register({ keyPrefix: "second:" });

    @Module({ imports: [first, second] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    expect(first.instanceId).not.toBe(second.instanceId);
  });

  test("keeps one registration's keys invisible to another", async () => {
    const first = CacheModule.register({ keyPrefix: "first:" });
    const second = CacheModule.register({ keyPrefix: "second:" });
    const firstToken = createToken<CacheService>("first-cache");
    const secondToken = createToken<CacheService>("second-cache");

    @Module({
      imports: [first],
      providers: [provideFactory(firstToken, [CacheService] as const, (cache) => cache)],
      exports: [firstToken],
    })
    class FirstModule {}

    @Module({
      imports: [second],
      providers: [provideFactory(secondToken, [CacheService] as const, (cache) => cache)],
      exports: [secondToken],
    })
    class SecondModule {}

    @Module({ imports: [FirstModule, SecondModule] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const firstCache = application.get(firstToken);
    const secondCache = application.get(secondToken);

    await firstCache.set("key", "first");

    expect(await firstCache.get<string>("key")).toBe("first");
    expect(await secondCache.get("key")).toBeUndefined();
  });
});

function captureAponiaError(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an AponiaError.");
}
