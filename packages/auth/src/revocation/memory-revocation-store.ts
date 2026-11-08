import { AponiaError } from "@aponiajs/common";
import type { RevocationStore } from "./revocation.types.ts";

/** A bounded, process-local revocation set. */
export class MemoryRevocationStore implements RevocationStore {
  readonly #entries = new Map<string, number>();
  readonly #maxEntries: number;
  readonly #now: () => number;

  constructor(options: { readonly maxEntries?: number; readonly now?: () => number } = {}) {
    const maxEntries = options.maxEntries ?? 10_000;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new AponiaError(
        "INVALID_AUTH_OPTIONS",
        "RevocationStore maxEntries must be a positive integer.",
      );
    }
    this.#maxEntries = maxEntries;
    this.#now = options.now ?? Date.now;
  }

  revoke(jti: string, expiresAt: number): void {
    this.#prune();
    if (!this.#entries.has(jti) && this.#entries.size >= this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) {
        this.#entries.delete(oldest);
      }
    }
    this.#entries.set(jti, expiresAt);
  }

  isRevoked(jti: string): boolean {
    this.#prune();
    return this.#entries.has(jti);
  }

  clear(): void {
    this.#entries.clear();
  }

  #prune(): void {
    const now = this.#now();
    for (const [jti, expiresAt] of this.#entries) {
      if (expiresAt <= now) {
        this.#entries.delete(jti);
      }
    }
  }
}
