import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { MemoryCacheStore } from "../src/index.ts";

describe("MemoryCacheStore", () => {
  test("stores and reads a value", () => {
    const store = new MemoryCacheStore();

    store.set("key", "value", 1_000);

    expect(store.get<string>("key")).toBe("value");
    expect(store.size).toBe(1);
  });

  test("expires an entry at its deadline and removes it lazily", () => {
    let now = 0;
    const store = new MemoryCacheStore({ now: () => now });
    store.set("key", "value", 10);

    now = 9;
    expect(store.get<string>("key")).toBe("value");

    now = 10;
    expect(store.get("key")).toBeUndefined();
    expect(store.size).toBe(0);
  });

  test("evicts the oldest insertion when the store is full", () => {
    const store = new MemoryCacheStore({ maxEntries: 2 });
    store.set("first", 1, 1_000);
    store.set("second", 2, 1_000);
    store.set("third", 3, 1_000);

    expect(store.get("first")).toBeUndefined();
    expect(store.get<number>("second")).toBe(2);
    expect(store.get<number>("third")).toBe(3);
  });

  test("deletes instead of storing when the TTL is not positive", () => {
    const store = new MemoryCacheStore();
    store.set("key", "value", 1_000);
    store.set("key", "replacement", 0);

    expect(store.get("key")).toBeUndefined();
  });

  test("deletes and clears entries", () => {
    const store = new MemoryCacheStore();
    store.set("first", 1, 1_000);
    store.set("second", 2, 1_000);

    expect(store.delete("first")).toBe(true);
    expect(store.delete("first")).toBe(false);
    expect(store.size).toBe(1);

    store.clear();
    expect(store.size).toBe(0);
  });

  test("refuses a boundary that cannot bound the store", () => {
    const error = captureAponiaError(() => new MemoryCacheStore({ maxEntries: 0 }));

    expect(error.code).toBe("INVALID_CONFIGURATION_VALUE");
    expect(error.details).toEqual({
      configuration: "cache",
      issues: ["maxEntries must be a positive integer"],
    });
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
