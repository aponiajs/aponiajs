import type { ClassToken } from "../interfaces/token.interface.ts";

/** Returns whether a filter's `@Catch()` targets match a thrown failure. */
export function matchesFilter(exceptions: readonly ClassToken<unknown>[], error: unknown): boolean {
  if (exceptions.length === 0) {
    return true;
  }
  return exceptions.some(
    (type) => error instanceof (type as unknown as new (...arguments_: never[]) => unknown),
  );
}
