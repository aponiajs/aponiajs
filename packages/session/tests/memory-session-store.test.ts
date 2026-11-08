import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { MemorySessionStore, type Session } from "../src/index.ts";

describe("MemorySessionStore", () => {
  test("stores and reads a live session", () => {
    let now = 1_000;
    const store = new MemorySessionStore({ now: () => now });
    const session: Session = {
      id: "one",
      data: { user: "ada" },
      createdAt: 1_000,
      expiresAt: 2_000,
    };
    store.set(session);

    expect(store.get("one")).toBe(session);
    expect(store.size).toBe(1);

    now = 2_000;
    expect(store.get("one")).toBeUndefined();
    expect(store.size).toBe(0);
  });

  test("evicts the oldest session when full", () => {
    const store = new MemorySessionStore({ maxSessions: 2 });
    store.set(session("first"));
    store.set(session("second"));
    store.set(session("third"));

    expect(store.get("first")).toBeUndefined();
    expect(store.get("second")).toBeDefined();
    expect(store.get("third")).toBeDefined();
  });

  test("deletes and clears sessions", () => {
    const store = new MemorySessionStore();
    store.set(session("first"));
    store.set(session("second"));

    expect(store.delete("first")).toBe(true);
    expect(store.delete("first")).toBe(false);
    store.clear();
    expect(store.size).toBe(0);
  });

  test("refuses an unbounded maximum", () => {
    const error = captureAponiaError(() => new MemorySessionStore({ maxSessions: 0 }));
    expect(error.code).toBe("INVALID_SESSION_OPTIONS");
    expect(error.details).toEqual({ issues: ["maxSessions must be a positive integer"] });
  });
});

function session(id: string): Session {
  return { id, data: {}, createdAt: 1, expiresAt: 9_999_999_999_999 };
}

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
