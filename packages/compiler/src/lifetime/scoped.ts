import { AponiaError } from "@aponiajs/common";
import type { LifetimeHandleController } from "../interfaces/lifetime.interface.ts";

/**
 * A value whose lifetime is owned by a {@link LifetimeScope}.
 *
 * `Scoped<T>` is deliberately not assignable to `T`: the only way to read the
 * value is `get()`, which checks the scope first, and `moveOut()` transfers the
 * value while revoking this handle. A captured handle therefore fails loudly
 * after its scope ends instead of serving stale state.
 *
 * @typeParam T - The value the handle owns while its scope is open.
 */
export class Scoped<T> {
  readonly #controller: LifetimeHandleController;
  readonly #value: T;
  #revoked = false;
  #revokeReason = "released";

  /** @internal Construct through `LifetimeScope.track`. */
  constructor(controller: LifetimeHandleController, value: T) {
    this.#controller = controller;
    this.#value = value;
  }

  /** The scope label this handle reports. */
  get label(): string {
    return this.#controller.label;
  }

  /** Whether this handle has been transferred or released. */
  get revoked(): boolean {
    return this.#revoked;
  }

  /**
   * Reads the value while the scope is open.
   *
   * @returns The tracked value.
   * @throws An `AponiaError` with `STALE_LIFETIME` after the scope exits or
   * after `moveOut()`.
   */
  get(): T {
    this.#assertReadable("get");
    return this.#value;
  }

  /**
   * Transfers the value out of the scope and revokes this handle.
   *
   * Use it only for work that deliberately outlives the scope; every later
   * `get()` on this handle fails with `STALE_LIFETIME`.
   *
   * @returns The tracked value.
   * @throws An `AponiaError` with `STALE_LIFETIME` after the scope exits or on
   * a second `moveOut()`.
   */
  moveOut(): T {
    this.#assertReadable("moveOut");
    this.#revoked = true;
    this.#revokeReason = "moved out";
    return this.#value;
  }

  /** Releases the handle without moving the value out. */
  release(): void {
    this.#revoked = true;
    this.#revokeReason = "released";
  }

  /** Releases the handle, the `using` form. */
  [Symbol.dispose](): void {
    this.release();
  }

  /** Releases the handle, the `await using` form. */
  [Symbol.asyncDispose](): Promise<void> {
    this.release();
    return Promise.resolve();
  }

  #assertReadable(operation: string): void {
    this.#controller.assertOpen(operation);
    if (this.#revoked) {
      throw new AponiaError(
        "STALE_LIFETIME",
        `The scoped handle for "${this.#controller.label}" is no longer readable because it was ${this.#revokeReason}.`,
        {
          label: this.#controller.label,
          operation,
          reason: this.#revokeReason,
        },
      );
    }
  }
}
