import { AponiaError } from "@aponiajs/common";
import { AsyncLocalStorageBorrowContext } from "./borrow-context.ts";
import type {
  AsyncRwLockOptions,
  BorrowContext,
  BorrowMode,
  BorrowOptions,
  BorrowToken,
} from "./borrow.types.ts";

interface Waiter {
  readonly mode: BorrowMode;
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: unknown) => void;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * A FIFO async reader/writer lock for shared state.
 *
 * Readers run concurrently. A writer waits for every reader and excludes new
 * ones; a reader that arrives after a queued writer waits behind it, so a busy
 * reader cannot starve a writer. Contention queues instead of failing; a
 * conflicting acquisition nested inside the same async chain fails immediately
 * with `BORROW_CONFLICT` and `reason: "self-reentrant"`.
 *
 * @example
 * ```ts
 * const lock = new AsyncRwLock({ timeoutMs: 5_000 });
 * await lock.read(async () => await readShared());
 * await lock.write(async () => await mutateShared());
 * ```
 */
export class AsyncRwLock {
  readonly #lock = Symbol("aponia.borrow-lock");
  readonly #label: string;
  readonly #timeoutMs: number;
  readonly #context: BorrowContext;
  readonly #queue: Waiter[] = [];
  #readers = 0;
  #writing = false;

  constructor(options: AsyncRwLockOptions = {}) {
    this.#label = options.label ?? "shared-state";
    this.#timeoutMs = options.timeoutMs ?? 0;
    this.#context = options.context ?? new AsyncLocalStorageBorrowContext();
  }

  /** The label failure details carry. */
  get label(): string {
    return this.#label;
  }

  /** How many waiters are queued for this lock. */
  get queueDepth(): number {
    return this.#queue.length;
  }

  /**
   * Acquires a read slot, joining other readers.
   *
   * @param work - The work to run while the slot is held.
   * @param options - The abort signal and timeout for this acquisition.
   * @returns The work's settled value.
   * @throws An `AponiaError` with `BORROW_CONFLICT` on self-reentrancy, timeout,
   * or abort.
   */
  async read<TResult>(
    work: () => TResult | Promise<TResult>,
    options: BorrowOptions = {},
  ): Promise<TResult> {
    return await this.#borrow("read", work, options);
  }

  /**
   * Acquires the exclusive write slot.
   *
   * @param work - The work to run while the slot is held.
   * @param options - The abort signal and timeout for this acquisition.
   * @returns The work's settled value.
   * @throws An `AponiaError` with `BORROW_CONFLICT` on self-reentrancy, timeout,
   * or abort.
   */
  async write<TResult>(
    work: () => TResult | Promise<TResult>,
    options: BorrowOptions = {},
  ): Promise<TResult> {
    return await this.#borrow("write", work, options);
  }

  async #borrow<TResult>(
    mode: BorrowMode,
    work: () => TResult | Promise<TResult>,
    options: BorrowOptions,
  ): Promise<TResult> {
    const current = this.#context.current();
    if (current?.lock === this.#lock) {
      if (current.mode === "read" && mode === "read") {
        return await work();
      }
      throw this.#selfReentrant(mode);
    }

    const release = await this.#acquire(mode, options);
    const token: BorrowToken = Object.freeze({ lock: this.#lock, mode });
    try {
      return await this.#context.run(token, async () => await work());
    } finally {
      release();
    }
  }

  async #acquire(mode: BorrowMode, options: BorrowOptions): Promise<() => void> {
    if (options.signal?.aborted === true) {
      throw this.#aborted(mode, "acquire");
    }
    if (this.#queue.length === 0 && this.#canGrant(mode)) {
      this.#take(mode);
      return this.#release(mode);
    }

    return await new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        mode,
        resolve,
        reject,
        settled: false,
      };
      this.#queue.push(waiter);

      const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          this.#fail(waiter, this.#timeout(mode));
        }, timeoutMs);
      }
      if (options.signal !== undefined) {
        waiter.signal = options.signal;
        waiter.onAbort = () => {
          this.#fail(waiter, this.#aborted(mode, "wait"));
        };
        options.signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
    });
  }

  #canGrant(mode: BorrowMode): boolean {
    if (this.#writing) {
      return false;
    }
    return mode === "read" ? true : this.#readers === 0;
  }

  #take(mode: BorrowMode): void {
    if (mode === "read") {
      this.#readers += 1;
      return;
    }
    this.#writing = true;
  }

  #release(mode: BorrowMode): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      if (mode === "read") {
        this.#readers -= 1;
      } else {
        this.#writing = false;
      }
      this.#processQueue();
    };
  }

  #processQueue(): void {
    if (this.#writing) {
      return;
    }
    while (this.#queue.length > 0) {
      const waiter = this.#queue[0];
      if (waiter === undefined) {
        return;
      }
      if (waiter.mode === "write") {
        if (this.#readers > 0) {
          return;
        }
        this.#queue.shift();
        this.#writing = true;
        this.#grant(waiter);
        return;
      }

      this.#queue.shift();
      this.#readers += 1;
      this.#grant(waiter);
      if (this.#queue[0]?.mode === "write") {
        return;
      }
    }
  }

  #grant(waiter: Waiter): void {
    if (waiter.settled) {
      return;
    }
    waiter.settled = true;
    this.#cleanup(waiter);
    waiter.resolve(this.#release(waiter.mode));
  }

  #fail(waiter: Waiter, error: AponiaError): void {
    if (waiter.settled) {
      return;
    }
    waiter.settled = true;
    this.#cleanup(waiter);
    const index = this.#queue.indexOf(waiter);
    if (index >= 0) {
      this.#queue.splice(index, 1);
    }
    waiter.reject(error);
  }

  #cleanup(waiter: Waiter): void {
    if (waiter.timer !== undefined) {
      clearTimeout(waiter.timer);
      waiter.timer = undefined;
    }
    if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.signal = undefined;
      waiter.onAbort = undefined;
    }
  }

  #selfReentrant(operation: BorrowMode): AponiaError {
    return new AponiaError(
      "BORROW_CONFLICT",
      `The lock "${this.#label}" cannot ${operation} inside its own conflicting borrow.`,
      {
        operation,
        reason: "self-reentrant",
        label: this.#label,
      },
    );
  }

  #timeout(operation: BorrowMode): AponiaError {
    return new AponiaError(
      "BORROW_CONFLICT",
      `The lock "${this.#label}" timed out waiting to ${operation}.`,
      {
        operation,
        reason: "timeout",
        label: this.#label,
        queueDepth: this.#queue.length,
      },
    );
  }

  #aborted(operation: BorrowMode, stage: "acquire" | "wait"): AponiaError {
    return new AponiaError(
      "BORROW_CONFLICT",
      `The lock "${this.#label}" was aborted before it could ${operation}.`,
      {
        operation,
        reason: "aborted",
        stage,
        label: this.#label,
      },
    );
  }
}
