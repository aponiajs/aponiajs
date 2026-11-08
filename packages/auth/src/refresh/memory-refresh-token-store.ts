import { AponiaError } from "@aponiajs/common";
import type { RefreshTokenRecord, RefreshTokenStore } from "./refresh-token.types.ts";

/** A bounded, process-local refresh-token store. */
export class MemoryRefreshTokenStore implements RefreshTokenStore {
  readonly #records = new Map<string, RefreshTokenRecord>();
  readonly #maxTokens: number;
  readonly #now: () => number;

  constructor(options: { readonly maxTokens?: number; readonly now?: () => number } = {}) {
    const maxTokens = options.maxTokens ?? 10_000;
    if (!Number.isInteger(maxTokens) || maxTokens < 1) {
      throw new AponiaError(
        "INVALID_AUTH_OPTIONS",
        "RefreshTokenStore maxTokens must be a positive integer.",
      );
    }
    this.#maxTokens = maxTokens;
    this.#now = options.now ?? Date.now;
  }

  create(record: RefreshTokenRecord): void {
    this.#prune();
    if (!this.#records.has(record.idHash) && this.#records.size >= this.#maxTokens) {
      const oldest = this.#records.keys().next().value;
      if (oldest !== undefined) {
        this.#records.delete(oldest);
      }
    }
    this.#records.set(record.idHash, record);
  }

  find(idHash: string): RefreshTokenRecord | undefined {
    const record = this.#records.get(idHash);
    if (record === undefined) {
      return undefined;
    }
    if (record.expiresAt <= this.#now()) {
      this.#records.delete(idHash);
      return undefined;
    }
    return record;
  }

  delete(idHash: string): boolean {
    return this.#records.delete(idHash);
  }

  deleteFamily(familyId: string): number {
    let deleted = 0;
    for (const [key, record] of this.#records) {
      if (record.familyId === familyId) {
        this.#records.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  clear(): void {
    this.#records.clear();
  }

  #prune(): void {
    const now = this.#now();
    for (const [key, record] of this.#records) {
      if (record.expiresAt <= now) {
        this.#records.delete(key);
      }
    }
  }
}
