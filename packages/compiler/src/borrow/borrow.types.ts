/**
 * A recursive readonly projection of a value.
 *
 * It is the type a reader receives from {@link RwCell} and
 * {@link SharedStateService}; the runtime view enforces the same rule for plain
 * objects and arrays.
 */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T;

/** Whether an acquisition reads or writes. */
export type BorrowMode = "read" | "write";

/** Why a borrow failed. */
export type BorrowFailureReason = "conflict" | "self-reentrant" | "timeout" | "aborted";

/** One acquisition's identity, propagated through async work. */
export interface BorrowToken {
  /** The lock this token belongs to. */
  readonly lock: symbol;
  /** The acquisition mode. */
  readonly mode: BorrowMode;
}

/** Options one async acquisition accepts. */
export interface BorrowOptions {
  /** Removes a queued waiter and rejects with `reason: "aborted"`. */
  readonly signal?: AbortSignal;
  /** Overrides the lock's timeout for this acquisition. */
  readonly timeoutMs?: number;
}

/** Options an {@link AsyncRwLock} accepts. */
export interface AsyncRwLockOptions {
  /** The label failures carry; defaults to `"shared-state"`. */
  readonly label?: string;
  /** How long a queued waiter waits; `0` or less disables the timeout. */
  readonly timeoutMs?: number;
  /** The context that records the token of the current async chain. */
  readonly context?: BorrowContext;
}

/** Records the acquisition that owns the current async chain. */
export interface BorrowContext {
  /** Runs work with `token` as the current acquisition. */
  run<T>(token: BorrowToken, work: () => T): T;
  /** The acquisition of the current async chain, or `undefined`. */
  current(): BorrowToken | undefined;
}
