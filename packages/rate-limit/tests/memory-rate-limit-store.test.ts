import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { MemoryRateLimitStore } from "../src/index.ts";

describe("MemoryRateLimitStore", () => {
  test("increments one bucket and keeps its window", () => {
    let now = 1_000;
    const store = new MemoryRateLimitStore({ now: () => now });

    expect(store.increment("key", 100)).toEqual({ count: 1, resetAt: 1_100 });
    now = 1_050;
    expect(store.increment("key", 100)).toEqual({ count: 2, resetAt: 1_100 });
  });

  test("starts a new window when the old one ends", () => {
    let now = 1_000;
    const store = new MemoryRateLimitStore({ now: () => now });
    store.increment("key", 100);
    now = 1_100;

    expect(store.increment("key", 100)).toEqual({ count: 1, resetAt: 1_200 });
  });

  test("evicts the oldest bucket when the store is full", () => {
    const store = new MemoryRateLimitStore({ maxKeys: 2 });
    store.increment("first", 100);
    store.increment("second", 100);
    store.increment("third", 100);

    expect(store.size).toBe(2);
    expect(store.increment("first", 100).count).toBe(1);
  });

  test("refuses a boundary that cannot bound the key space", () => {
    const error = captureAponiaError(() => new MemoryRateLimitStore({ maxKeys: 0 }));

    expect(error.code).toBe("INVALID_RATE_LIMIT");
    expect(error.details).toEqual({
      issues: ["maxKeys must be a positive integer"],
    });
    expect(Object.isFrozen(error.details)).toBe(true);
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
