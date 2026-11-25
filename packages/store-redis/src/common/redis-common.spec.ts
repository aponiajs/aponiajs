import { expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import {
  closeRedisClient,
  deleteByPattern,
  deleteKeys,
  resolveRedisStoreOptions,
} from "./redis-common.ts";
import type { RedisClientInterface } from "../interfaces/redis.interface.ts";

/**
 * The helpers every store shares: option normalization, the paged clear, and
 * the once-only client release. Each case drives the smallest client that
 * states the branch under test, so no Redis server is involved.
 */

function clientWith(overrides: Partial<RedisClientInterface> = {}): RedisClientInterface {
  return {
    get: async () => null,
    set: async () => "OK",
    del: async () => 0,
    incr: async () => 1,
    expire: async () => 1,
    keys: async () => [],
    eval: async () => null,
    ...overrides,
  };
}

test("refuses a closeClient switch that is not a boolean", () => {
  let failure: unknown;
  try {
    resolveRedisStoreOptions(
      { client: clientWith(), closeClient: "yes" as never },
      "aponia:",
      "cache",
    );
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AponiaError);
  expect((failure as AponiaError).code).toBe("INVALID_CONFIGURATION");
  expect((failure as AponiaError).details).toEqual({ store: "cache" });
});

test("clears through KEYS and DEL when the client states no SCAN or UNLINK", async () => {
  const calls: string[] = [];
  const client = clientWith({
    keys: async (pattern) => {
      calls.push(`keys:${pattern}`);
      return ["a", "b"];
    },
    del: async (keys) => {
      calls.push(`del:${String(keys)}`);
      return 2;
    },
  });

  await deleteByPattern(client, "cache:*");

  expect(calls).toEqual(["keys:cache:*", "del:a,b"]);
});

test("clears an empty page without calling DEL", async () => {
  let deleted = 0;
  const client = clientWith({
    del: async () => {
      deleted += 1;
      return 0;
    },
  });

  expect(await deleteKeys(client, [])).toBe(0);
  expect(deleted).toBe(0);
});

test("releases a client through disconnect when it states no quit, and only once", async () => {
  let disconnects = 0;
  const client = clientWith({
    quit: undefined,
    disconnect: async () => {
      disconnects += 1;
    },
  });

  await closeRedisClient(client);
  await closeRedisClient(client);

  expect(disconnects).toBe(1);
});

test("releases a client through quit when it states one", async () => {
  let quits = 0;
  let disconnects = 0;
  const client = clientWith({
    quit: async () => {
      quits += 1;
      return "OK";
    },
    disconnect: async () => {
      disconnects += 1;
    },
  });

  await closeRedisClient(client);

  expect(quits).toBe(1);
  expect(disconnects).toBe(0);
});
