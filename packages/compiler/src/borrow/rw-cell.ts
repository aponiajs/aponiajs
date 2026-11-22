import { AponiaError } from "@aponiajs/common";
import type { DeepReadonly } from "./borrow.types.ts";
import {
  createBorrowViewState,
  createExclusiveView,
  createReadonlyView,
} from "./revocable-views.ts";

/** Options naming one cell in failure details. */
export interface RwCellOptions {
  /** The label failure details carry; defaults to `"cell"`. */
  readonly label?: string;
}

/**
 * A single value many readers may inspect or one writer may mutate.
 *
 * `RwCell` fails fast: a conflicting borrow throws `BORROW_CONFLICT` at the
 * moment it is attempted, which is what makes synchronous re-entrancy and a
 * deliberate async probe visible instead of waiting. Queued shared traffic
 * belongs to {@link AsyncRwLock}.
 *
 * @typeParam T - The value the cell owns.
 *
 * @example
 * ```ts
 * const cell = new RwCell({ count: 0 });
 * cell.read((state) => state.count);
 * cell.write((state) => {
 *   state.count += 1;
 * });
 * ```
 */
export class RwCell<T> {
  readonly #label: string;
  #value: T;
  #readers = 0;
  #writing = false;
  #version = 0;

  constructor(initial: T, options: RwCellOptions = {}) {
    this.#value = initial;
    this.#label = options.label ?? "cell";
  }

  /** The label failure details carry. */
  get label(): string {
    return this.#label;
  }

  /** How many successful writes this cell has recorded. */
  get version(): number {
    return this.#version;
  }

  /**
   * Runs a synchronous reader with a deep revocable readonly view.
   *
   * Readers may nest. A reader while a writer holds the cell fails with
   * `BORROW_CONFLICT`.
   *
   * @param work - The reader.
   * @returns Whatever the reader returns.
   * @throws An `AponiaError` with `BORROW_CONFLICT` on a conflicting borrow.
   */
  read<TResult>(work: (view: DeepReadonly<T>) => TResult): TResult {
    this.#assertReadable("read");
    this.#readers += 1;
    const state = createBorrowViewState(this.#label);
    try {
      return work(createReadonlyView(this.#value, state));
    } finally {
      state.revoked = true;
      this.#readers -= 1;
    }
  }

  /**
   * Runs a synchronous writer with a revocable exclusive view.
   *
   * A successful return bumps `version`. A writer while a reader or another
   * writer holds the cell fails with `BORROW_CONFLICT`.
   *
   * @param work - The writer.
   * @returns Whatever the writer returns.
   * @throws An `AponiaError` with `BORROW_CONFLICT` on a conflicting borrow.
   */
  write<TResult>(work: (state: T) => TResult): TResult {
    this.#assertWritable("write");
    this.#writing = true;
    const state = createBorrowViewState(this.#label);
    try {
      const result = work(createExclusiveView(this.#value, state));
      this.#version += 1;
      return result;
    } finally {
      state.revoked = true;
      this.#writing = false;
    }
  }

  /**
   * Runs an asynchronous reader that fails fast when the cell is taken.
   *
   * @param work - The reader.
   * @returns The reader's settled value.
   * @throws An `AponiaError` with `BORROW_CONFLICT` on a conflicting borrow.
   */
  async tryReadAsync<TResult>(
    work: (view: DeepReadonly<T>) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    this.#assertReadable("readAsync");
    this.#readers += 1;
    const state = createBorrowViewState(this.#label);
    try {
      return await work(createReadonlyView(this.#value, state));
    } finally {
      state.revoked = true;
      this.#readers -= 1;
    }
  }

  /**
   * Runs an asynchronous writer that fails fast when the cell is taken.
   *
   * @param work - The writer.
   * @returns The writer's settled value.
   * @throws An `AponiaError` with `BORROW_CONFLICT` on a conflicting borrow.
   */
  async tryWriteAsync<TResult>(work: (state: T) => TResult | Promise<TResult>): Promise<TResult> {
    this.#assertWritable("writeAsync");
    this.#writing = true;
    const state = createBorrowViewState(this.#label);
    try {
      const result = await work(createExclusiveView(this.#value, state));
      this.#version += 1;
      return result;
    } finally {
      state.revoked = true;
      this.#writing = false;
    }
  }

  #assertReadable(operation: string): void {
    if (this.#writing) {
      throw this.#conflict(operation);
    }
  }

  #assertWritable(operation: string): void {
    if (this.#writing || this.#readers > 0) {
      throw this.#conflict(operation);
    }
  }

  #conflict(operation: string): AponiaError {
    return new AponiaError(
      "BORROW_CONFLICT",
      `The cell "${this.#label}" cannot ${operation} while ${this.#writing ? "a writer" : `${this.#readers} reader${this.#readers === 1 ? "" : "s"}`} holds it.`,
      {
        operation,
        reason: "conflict",
        label: this.#label,
        readers: this.#readers,
        writer: this.#writing,
      },
    );
  }
}
