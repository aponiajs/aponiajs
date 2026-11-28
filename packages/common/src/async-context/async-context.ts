/** Runs one unit of work outside a runtime's async-context store. */
export type AsyncContextExit = <T>(work: () => T) => T;

const exits = new Set<AsyncContextExit>();

/**
 * Registers the boundary a runtime uses to leave its async-context store.
 *
 * A runtime-neutral package cannot import `node:async_hooks` or name another
 * package's storage. The runtime that owns the storage registers its `exit`
 * here, and a background worker asks every registered boundary to leave before
 * it runs application code.
 *
 * @param exit - The runtime's `AsyncLocalStorage.exit`, bound to its storage.
 * @returns A function that removes the boundary.
 *
 * @internal
 */
export function registerAsyncContextExit(exit: AsyncContextExit): () => void {
  exits.add(exit);
  return () => {
    exits.delete(exit);
  };
}

/**
 * Runs work outside every registered async-context store.
 *
 * Boundaries are entered in registration order. The synchronous `exit` calls
 * also cover async work the callback starts, so a timer or job handler cannot
 * inherit the caller's request identity.
 *
 * @param work - The work to run outside the registered stores.
 * @returns The work's result.
 *
 * @internal
 */
export function runOutsideAsyncContexts<T>(work: () => T): T {
  const registered = [...exits];
  const run = (index: number): T => {
    const exit = registered[index];
    return exit === undefined ? work() : exit(() => run(index + 1));
  };
  return run(0);
}
