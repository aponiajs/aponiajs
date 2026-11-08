import { AponiaError } from "@aponiajs/common";
import type { IdempotencyStore, StoredIdempotentResponse } from "./idempotency-store.types.ts";

interface Entry {
  readonly response: StoredIdempotentResponse;
  readonly expiresAt: number;
}

/** A bounded, process-local idempotency store. */
export class MemoryIdempotencyStore implements IdempotencyStore {
  readonly #entries = new Map<string, Entry>();
  readonly #maxEntries: number;
  readonly #now: () => number;

  constructor(options: { readonly maxEntries?: number; readonly now?: () => number } = {}) {
    const maxEntries = options.maxEntries ?? 1_000;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new AponiaError("INVALID_IDEMPOTENCY_OPTIONS", "The idempotency store is invalid.", {
        issues: Object.freeze(["maxEntries must be a positive integer"]),
      });
    }
    this.#maxEntries = maxEntries;
    this.#now = options.now ?? Date.now;
  }

  get(key: string): StoredIdempotentResponse | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.response;
  }

  set(key: string, response: StoredIdempotentResponse, ttlMs: number): void {
    this.#prune();
    if (!this.#entries.has(key) && this.#entries.size >= this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) {
        this.#entries.delete(oldest);
      }
    }
    this.#entries.set(key, Object.freeze({ response, expiresAt: this.#now() + ttlMs }));
  }

  delete(key: string): boolean {
    return this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }

  #prune(): void {
    const now = this.#now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) {
        this.#entries.delete(key);
      }
    }
  }
}
