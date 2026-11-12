import { AponiaError } from "@aponiajs/common";
import type {
  RefreshTokenConsumeResult,
  RefreshTokenRecord,
  RefreshTokenStore,
} from "./refresh-token.types.ts";

interface UsedToken {
  readonly familyId: string;
  readonly expiresAt: number;
}

/** A bounded, process-local refresh-token store. */
export class MemoryRefreshTokenStore implements RefreshTokenStore {
  readonly #records = new Map<string, RefreshTokenRecord>();
  readonly #used = new Map<string, UsedToken>();
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

  consume(idHash: string): RefreshTokenConsumeResult | undefined {
    this.#prune();
    const record = this.#records.get(idHash);
    if (record !== undefined) {
      this.#records.delete(idHash);
      this.#rememberUsed(idHash, record);
      return { record };
    }
    const used = this.#used.get(idHash);
    if (used !== undefined) {
      return { familyId: used.familyId };
    }
    return undefined;
  }

  /**
   * Records a consumed token without letting the tombstones outgrow the store.
   *
   * They share the record cap: a tombstone retained forever would make every
   * `create` and `consume` scan an unbounded map, which one client rotating a
   * token in a loop could turn into a memory and CPU denial of service. When
   * the cap is reached the oldest tombstone is dropped, so reuse of a very old
   * consumed token is answered as unknown rather than as family reuse; the
   * token itself is already gone and cannot be rotated either way.
   */
  #rememberUsed(idHash: string, record: RefreshTokenRecord): void {
    if (!this.#used.has(idHash) && this.#used.size >= this.#maxTokens) {
      const oldest = this.#used.keys().next().value;
      if (oldest !== undefined) {
        this.#used.delete(oldest);
      }
    }
    this.#used.set(idHash, { familyId: record.familyId, expiresAt: record.expiresAt });
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
    this.#used.clear();
  }

  #prune(): void {
    const now = this.#now();
    for (const [key, record] of this.#records) {
      if (record.expiresAt <= now) {
        this.#records.delete(key);
      }
    }
    for (const [key, used] of this.#used) {
      if (used.expiresAt <= now) {
        this.#used.delete(key);
      }
    }
  }
}
