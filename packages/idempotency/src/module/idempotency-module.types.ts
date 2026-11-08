import type { IdempotencyStore } from "../store/idempotency-store.types.ts";

/** Options `IdempotencyModule.register` accepts. */
export interface IdempotencyModuleOptions {
  /** How long a recorded response may be replayed; defaults to 24 hours. */
  readonly ttlMs?: number;
  /** The entry cap of the default store; ignored when `store` is supplied. */
  readonly maxEntries?: number;
  /** The request header carrying the key; defaults to `idempotency-key`. */
  readonly header?: string;
  /** Whether a mutating request without the header is refused; defaults to false. */
  readonly requireKey?: boolean;
  /** The methods this plugin covers; defaults to `POST`, `PATCH`, and `PUT`. */
  readonly methods?: readonly string[];
  /** The store; defaults to a bounded process-local one. */
  readonly store?: IdempotencyStore;
  /** The clock the default store reads; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Called when the store cannot read or write; defaults to silence. */
  readonly onError?: (error: unknown, key: string) => void;
}

/** The options the plugin reads after validation. */
export interface ResolvedIdempotencyOptions {
  readonly ttlMs: number;
  readonly header: string;
  readonly requireKey: boolean;
  readonly methods: readonly string[];
  readonly store: IdempotencyStore;
  readonly onError: (error: unknown, key: string) => void;
}
