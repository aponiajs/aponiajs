import type {
  IdempotencyAcquireResult,
  IdempotencyRecord,
  IdempotencyStore,
} from "../interfaces/idempotency-store.interface.ts";

interface MemoryEntry {
  status: "in_flight" | "completed";
  expiresAt: number;
  record?: IdempotencyRecord;
}

/**
 * Bounded in-memory `IdempotencyStore` with TTL expiration and oldest-entry eviction.
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
  readonly #maxKeys: number;
  readonly #now: () => number;
  readonly #entries = new Map<string, MemoryEntry>();

  constructor(maxKeys = 10_000, now: () => number = Date.now) {
    this.#maxKeys = maxKeys;
    this.#now = now;
  }

  acquire(key: string, ttlMs: number, _requestHash: string): IdempotencyAcquireResult {
    const now = this.#now();
    const existing = this.#entries.get(key);
    if (existing !== undefined) {
      if (existing.expiresAt <= now) {
        this.#entries.delete(key);
      } else if (existing.status === "in_flight") {
        return { state: "in_flight" };
      } else {
        return { state: "completed", record: existing.record! };
      }
    }

    if (this.#entries.size >= this.#maxKeys) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.#entries.delete(oldestKey);
      }
    }

    this.#entries.set(key, {
      status: "in_flight",
      expiresAt: now + ttlMs,
    });
    return { state: "acquired" };
  }

  complete(key: string, record: IdempotencyRecord, ttlMs: number): void {
    const now = this.#now();
    this.#entries.set(key, {
      status: "completed",
      expiresAt: now + ttlMs,
      record,
    });
  }

  release(key: string): void {
    this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }
}
