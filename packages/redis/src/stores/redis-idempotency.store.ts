import type { RedisClientLike } from "../interfaces/redis-client.interface.ts";

export interface RedisIdempotencyRecord {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly requestHash: string;
  readonly expiresAt: number;
}

export type RedisIdempotencyAcquireResult =
  | { readonly state: "acquired" }
  | { readonly state: "in_flight" }
  | { readonly state: "completed"; readonly record: RedisIdempotencyRecord };

const inFlightSentinel = "__in_flight__";

/** Redis-backed implementation of `@aponiajs/idempotency`'s `IdempotencyStore`. */
export class RedisIdempotencyStore {
  readonly #client: RedisClientLike;
  readonly #prefix: string;

  constructor(client: RedisClientLike, prefix = "aponia:idem:") {
    this.#client = client;
    this.#prefix = prefix;
  }

  async acquire(
    key: string,
    ttlMs: number,
    _requestHash: string,
  ): Promise<RedisIdempotencyAcquireResult> {
    const fullKey = this.#prefix + key;
    const setResult = await this.#client.set(fullKey, inFlightSentinel, { NX: true, PX: ttlMs });
    if (setResult === "OK") {
      return { state: "acquired" };
    }
    const existing = await this.#client.get(fullKey);
    if (existing === null) {
      const retry = await this.#client.set(fullKey, inFlightSentinel, { NX: true, PX: ttlMs });
      if (retry === "OK") {
        return { state: "acquired" };
      }
      return { state: "in_flight" };
    }
    if (existing === inFlightSentinel) {
      return { state: "in_flight" };
    }
    return {
      state: "completed",
      record: JSON.parse(existing) as RedisIdempotencyRecord,
    };
  }

  async complete(key: string, record: RedisIdempotencyRecord, ttlMs: number): Promise<void> {
    await this.#client.set(this.#prefix + key, JSON.stringify(record), { PX: ttlMs });
  }

  async release(key: string): Promise<void> {
    await this.#client.del(this.#prefix + key);
  }
}
