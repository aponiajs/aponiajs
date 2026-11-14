import type { FORWARD_REF_SYMBOL } from "./forward-ref.constants.ts";

/**
 * A forward reference wrapper that defers evaluating a class, module, or token.
 */
export interface ForwardReference<T = unknown> {
  readonly [FORWARD_REF_SYMBOL]: true;
  readonly forwardRef: () => T;
}
