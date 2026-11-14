import { FORWARD_REF_SYMBOL } from "./forward-ref.constants.ts";
import type { ForwardReference } from "./forward-ref.types.ts";

export { FORWARD_REF_SYMBOL };

/**
 * Wraps a reference in a forward-reference thunk so circular module imports
 * or co-dependent services can be resolved lazily.
 *
 * @param fn - A factory returning the target class, module, or token.
 * @returns A frozen forward-reference object.
 *
 * @example
 * ```ts
 * @Module({
 *   imports: [forwardRef(() => OtherModule)],
 * })
 * export class AppModule {}
 * ```
 */
export function forwardRef<T = unknown>(fn: () => T): ForwardReference<T> {
  return Object.freeze({
    [FORWARD_REF_SYMBOL]: true as const,
    forwardRef: fn,
  });
}

/**
 * Determines whether a value is a forward-reference object.
 *
 * @param value - The value to test.
 * @returns True when value is a {@link ForwardReference}.
 */
export function isForwardRef(value: unknown): value is ForwardReference {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string | symbol, unknown>)[FORWARD_REF_SYMBOL] === true
  );
}

/**
 * Unwraps a target if it is wrapped in a forward-reference thunk; otherwise
 * returns the target unchanged.
 *
 * @param target - The target or forward reference to unwrap.
 * @returns The resolved target.
 */
export function resolveForwardRef<T>(target: T | ForwardReference<T>): T {
  return isForwardRef(target) ? (target.forwardRef() as T) : target;
}
