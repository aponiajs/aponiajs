import {
  createToken,
  provideValue,
  type InjectionToken,
  type ValueProvider,
} from "@aponiajs/common";
import { AsyncRwLock } from "../borrow/async-rw-lock.ts";
import type {
  AsyncRwLockOptions,
  BorrowOptions,
  DeepReadonly,
} from "../interfaces/borrow.interface.ts";
import { RwCell } from "../borrow/rw-cell.ts";

/** Options one `provideSharedState` registration accepts. */
export interface SharedStateOptions {
  /** The label failures carry; defaults to `"shared-state"`. */
  readonly label?: string;
  /** The cell's own label; defaults to the registration label. */
  readonly cellLabel?: string;
  /** How long a queued async writer waits; `0` or less disables the timeout. */
  readonly timeoutMs?: number;
  /** An explicit token, when the application already mints one. */
  readonly token?: InjectionToken<SharedStateService<unknown>>;
  /** The borrow context the lock records identity in. */
  readonly context?: AsyncRwLockOptions["context"];
}

/**
 * The safe surface an application reaches shared state through.
 *
 * There is no raw handle: a synchronous reader receives a deep readonly view,
 * a synchronous writer an exclusive view, and the async variants queue instead
 * of failing on ordinary contention.
 *
 * @typeParam T - The shared state this service owns.
 */
export class SharedStateService<T> {
  readonly #cell: RwCell<T>;
  readonly #lock: AsyncRwLock;
  readonly #label: string;

  /** @internal Construct through `provideSharedState`. */
  constructor(initial: T, options: SharedStateOptions = {}) {
    this.#label = options.label ?? "shared-state";
    this.#cell = new RwCell(initial, { label: options.cellLabel ?? this.#label });
    this.#lock = new AsyncRwLock({
      label: this.#label,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.context === undefined ? {} : { context: options.context }),
    });
  }

  /** The label failures carry. */
  get label(): string {
    return this.#label;
  }

  /** How many successful writes this state has recorded. */
  get version(): number {
    return this.#cell.version;
  }

  /**
   * Runs a synchronous reader with a deep readonly view.
   *
   * @param work - The reader.
   * @returns Whatever the reader returns.
   */
  read<TResult>(work: (state: DeepReadonly<T>) => TResult): TResult {
    return this.#cell.read(work);
  }

  /**
   * Runs a synchronous writer with an exclusive view.
   *
   * @param work - The writer.
   * @returns Whatever the writer returns.
   */
  write<TResult>(work: (state: T) => TResult): TResult {
    return this.#cell.write(work);
  }

  /**
   * Runs an asynchronous reader; readers run concurrently.
   *
   * @param work - The reader.
   * @param options - The abort signal and timeout for this acquisition.
   * @returns The reader's settled value.
   */
  readAsync<TResult>(
    work: (state: DeepReadonly<T>) => TResult | Promise<TResult>,
    options: BorrowOptions = {},
  ): Promise<TResult> {
    return this.#lock.read(() => this.#cell.tryReadAsync(work), options);
  }

  /**
   * Runs an asynchronous writer; writers queue FIFO.
   *
   * @param work - The writer.
   * @param options - The abort signal and timeout for this acquisition.
   * @returns The writer's settled value.
   */
  writeAsync<TResult>(
    work: (state: T) => TResult | Promise<TResult>,
    options: BorrowOptions = {},
  ): Promise<TResult> {
    return this.#lock.write(() => this.#cell.tryWriteAsync(work), options);
  }
}

/** What one `provideSharedState` call returns. */
export interface SharedStateRegistration<T> {
  /** The token the service resolves through. */
  readonly token: InjectionToken<SharedStateService<T>>;
  /** The value provider a module declares. */
  readonly provider: ValueProvider<SharedStateService<T>>;
  /** The instance the provider answers, for direct use outside DI. */
  readonly service: SharedStateService<T>;
}

/**
 * Creates one shared state, its token, and the provider that exposes it.
 *
 * @param initial - The state the service starts from.
 * @param options - Label, timeout, token, and borrow context.
 * @returns A frozen registration a module declares in `providers`.
 *
 * @example
 * ```ts
 * const counter = provideSharedState({ count: 0 }, { label: "counter" });
 * container.get(counter.token).write((state) => {
 *   state.count += 1;
 * });
 * ```
 */
export function provideSharedState<T>(
  initial: T,
  options: SharedStateOptions = {},
): SharedStateRegistration<T> {
  const label = options.label ?? "shared-state";
  const service = new SharedStateService(initial, options);
  const token =
    options.token === undefined
      ? createToken<SharedStateService<T>>(label)
      : (options.token as InjectionToken<SharedStateService<T>>);
  return Object.freeze({
    token,
    provider: provideValue(token, service),
    service,
  });
}
