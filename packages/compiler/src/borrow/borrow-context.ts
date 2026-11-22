import { AsyncLocalStorage } from "node:async_hooks";
import type { BorrowContext, BorrowToken } from "./borrow.types.ts";

/**
 * The `node:async_hooks` implementation of a {@link BorrowContext}.
 *
 * The compiler package uses `node:async_hooks` for this identity and nothing
 * else, so a lock can tell a nested acquisition from a queued one without
 * timers.
 */
export class AsyncLocalStorageBorrowContext implements BorrowContext {
  readonly #storage: AsyncLocalStorage<BorrowToken>;

  constructor(storage?: AsyncLocalStorage<BorrowToken>) {
    this.#storage = storage ?? new AsyncLocalStorage<BorrowToken>();
  }

  run<T>(token: BorrowToken, work: () => T): T {
    return this.#storage.run(token, work);
  }

  current(): BorrowToken | undefined {
    return this.#storage.getStore();
  }
}
