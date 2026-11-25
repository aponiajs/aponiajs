import { describe, expect, test } from "bun:test";
import { teardownIssues } from "@aponiajs/testing";
import {
  RedisCacheStore,
  RedisIdempotencyStore,
  RedisRateLimitStore,
  RedisRefreshTokenStore,
  RedisRevocationStore,
  RedisSessionStore,
  type RedisClientInterface,
} from "./index.ts";

class QuitTrackingClient implements RedisClientInterface {
  quitCalls = 0;
  readonly writes: { readonly key: string; readonly options?: object }[] = [];

  async get(): Promise<null> {
    return null;
  }

  async set(
    key: string,
    _value: string,
    options?: { EX?: number; PX?: number; NX?: boolean; XX?: boolean },
  ): Promise<string | null> {
    this.writes.push({ key, options });
    return "OK";
  }

  async del(): Promise<number> {
    return 1;
  }

  async incr(): Promise<number> {
    return 1;
  }

  async expire(): Promise<boolean> {
    return true;
  }

  async keys(): Promise<string[]> {
    return [];
  }

  async eval(): Promise<unknown> {
    return [1, 1_000];
  }

  async quit(): Promise<string> {
    this.quitCalls += 1;
    return "OK";
  }
}

describe("Redis store teardown", () => {
  const stores = [
    (client: RedisClientInterface) => new RedisCacheStore({ client }),
    (client: RedisClientInterface) => new RedisRateLimitStore({ client }),
    (client: RedisClientInterface) => new RedisSessionStore({ client }),
    (client: RedisClientInterface) => new RedisIdempotencyStore({ client }),
    (client: RedisClientInterface) => new RedisRevocationStore({ client }),
    (client: RedisClientInterface) => new RedisRefreshTokenStore({ client }),
  ];

  test("every store exposes an idempotent close and async dispose", async () => {
    for (const create of stores) {
      const client = new QuitTrackingClient();
      const store = create(client);

      expect(await teardownIssues(() => store.close())).toEqual([]);
      expect(client.quitCalls).toBe(1);

      await store[Symbol.asyncDispose]();
      expect(client.quitCalls).toBe(1);
    }
  });

  test("stores sharing a client release it once", async () => {
    const client = new QuitTrackingClient();
    const first = new RedisCacheStore({ client });
    const second = new RedisSessionStore({ client });

    await first.close();
    await second.close();

    expect(client.quitCalls).toBe(1);
  });

  test("closeClient false leaves the client to the application", async () => {
    const client = new QuitTrackingClient();
    const store = new RedisCacheStore({ client, closeClient: false });

    await store.close();

    expect(client.quitCalls).toBe(0);
  });

  test("a cache write without a lifetime never expires", async () => {
    const client = new QuitTrackingClient();
    const store = new RedisCacheStore({ client });

    await store.set("key", "value");

    expect(client.writes).toEqual([{ key: "aponia:cache:key", options: undefined }]);
  });

  test("a cache write with a lifetime sets an EX", async () => {
    const client = new QuitTrackingClient();
    const store = new RedisCacheStore({ client });

    await store.set("key", "value", 2_500);

    expect(client.writes).toEqual([{ key: "aponia:cache:key", options: { EX: 3 } }]);
  });

  test("a non-positive lifetime deletes instead of writing", async () => {
    const client = new QuitTrackingClient();
    const store = new RedisCacheStore({ client });

    await store.set("key", "value", 0);

    expect(client.writes).toEqual([]);
  });
});
