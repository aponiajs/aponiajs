import type { ConfigurableModuleAsyncOptions } from "@aponiajs/common";

/** Stored response snapshot for a completed idempotent request. */
export interface IdempotencyRecord {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly requestHash: string;
  readonly expiresAt: number;
}

/** Result returned by `IdempotencyStore.acquire`. */
export type IdempotencyAcquireResult =
  | { readonly state: "acquired" }
  | { readonly state: "in_flight" }
  | { readonly state: "completed"; readonly record: IdempotencyRecord };

/** Pluggable storage contract for idempotency keys and cached responses. */
export interface IdempotencyStore {
  /**
   * Attempts to claim `key` for an in-flight request.
   * Returns `"acquired"` when the caller owns execution, `"in_flight"` when
   * another request is currently running for `key`, or `"completed"` with the
   * stored response record.
   */
  acquire(
    key: string,
    ttlMs: number,
    requestHash: string,
  ): IdempotencyAcquireResult | Promise<IdempotencyAcquireResult>;

  /** Persists the completed response record for `key`. */
  complete(key: string, record: IdempotencyRecord, ttlMs: number): void | Promise<void>;

  /** Releases an in-flight lock when the handler fails before producing a response. */
  release(key: string): void | Promise<void>;
}

/** Options accepted by `IdempotencyModule.forRoot`. */
export interface IdempotencyModuleOptions {
  /** Request header carrying the idempotency key; defaults to `"idempotency-key"`. */
  readonly headerName?: string;
  /** HTTP methods subject to idempotency; defaults to `["POST", "PUT", "PATCH"]`. */
  readonly methods?: readonly string[];
  /** Key and response retention TTL in milliseconds; defaults to `86_400_000` (24h). */
  readonly ttlMs?: number;
  /** Whether to reject matching methods that omit the idempotency header (`400`); defaults to `false`. */
  readonly requireKey?: boolean;
  /** Custom store implementation; defaults to bounded `MemoryIdempotencyStore`. */
  readonly store?: IdempotencyStore;
  /** Maximum entries in the default in-memory store; defaults to `10_000`. */
  readonly maxKeys?: number;
}

/** Validated options resolved by `IdempotencyModule`. */
export interface ResolvedIdempotencyOptions {
  readonly headerName: string;
  readonly methods: ReadonlySet<string>;
  readonly ttlMs: number;
  readonly requireKey: boolean;
  readonly maxKeys: number;
}

/** Asynchronous options accepted by `IdempotencyModule.forRootAsync`. */
export type IdempotencyModuleAsyncOptions =
  ConfigurableModuleAsyncOptions<IdempotencyModuleOptions>;
