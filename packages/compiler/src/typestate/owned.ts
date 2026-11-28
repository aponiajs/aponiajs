import { AponiaError } from "@aponiajs/common";

/**
 * A value that may be consumed exactly once.
 *
 * `Owned<T>` is deliberately not assignable to `T`: `consume()` returns the
 * value once and every later consumption throws `CONSUMED_STATE`. `peek()`
 * inspects without consuming. TypeScript has no linear types, so the runtime
 * check is the guarantee; `using` is the idiomatic release form.
 *
 * @typeParam T - The owned value.
 *
 * @example
 * ```ts
 * using lease = new Owned(await acquireLease());
 * const value = lease.consume();
 * ```
 */
export class Owned<T> {
  readonly #value: T;
  readonly #label: string;
  #consumed = false;

  constructor(value: T, options: { readonly label?: string } = {}) {
    this.#value = value;
    this.#label = options.label ?? "owned value";
  }

  /** The label failures carry. */
  get label(): string {
    return this.#label;
  }

  /** Whether the value has been consumed or disposed. */
  get consumed(): boolean {
    return this.#consumed;
  }

  /**
   * Consumes the value.
   *
   * @returns The owned value.
   * @throws An `AponiaError` with `CONSUMED_STATE` on a second consumption.
   */
  consume(): T {
    if (this.#consumed) {
      throw new AponiaError(
        "CONSUMED_STATE",
        `The owned value "${this.#label}" was already consumed.`,
        { label: this.#label, reason: "consumed" },
      );
    }
    this.#consumed = true;
    return this.#value;
  }

  /** Inspects the value without consuming it. */
  peek(): T {
    return this.#value;
  }

  /** Releases the value; idempotent, so a `using` block after `consume` is safe. */
  dispose(): void {
    this.#consumed = true;
  }

  /** Releases the value, the `using` form. */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /** Releases the value, the `await using` form. */
  [Symbol.asyncDispose](): Promise<void> {
    this.dispose();
    return Promise.resolve();
  }
}

/**
 * Wraps a function so it runs at most once.
 *
 * @param work - The function to run once.
 * @returns A wrapper preserving `this` and the arguments; a second call throws
 * `CONSUMED_STATE`.
 *
 * @example
 * ```ts
 * const release = once(() => store.release(key));
 * release();
 * ```
 */
export function once<TThis, TArguments extends unknown[], TResult>(
  work: (this: TThis, ...args: TArguments) => TResult,
): (this: TThis, ...args: TArguments) => TResult {
  let consumed = false;
  const name = work.name === "" ? "<anonymous>" : work.name;
  return function onceWrapper(this: TThis, ...args: TArguments): TResult {
    if (consumed) {
      throw new AponiaError("CONSUMED_STATE", `The once wrapper "${name}" was already called.`, {
        function: name,
        reason: "consumed",
      });
    }
    consumed = true;
    return Reflect.apply(work, this, args) as TResult;
  };
}
