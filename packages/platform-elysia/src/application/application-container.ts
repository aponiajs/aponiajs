import { AponiaError, tokenName, type Token } from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";

const containerKey: unique symbol = Symbol.for("aponia.application.container");

// Every export below is internal: none appears in this package's barrel, and the
// marker is what keeps a future `export *` from publishing them.

/**
 * @internal
 *
 * Attaches the boot's container to the application it produced.
 *
 * Non-enumerable because Elysia composes by walking an instance's keys,
 * non-writable so nothing overwrites the decision a boot made, and
 * non-configurable so nothing undoes it. An application no boot produced must
 * read as `undefined` rather than as an empty container. Rides a symbol rather
 * than a constructor parameter so the wrapper's exported two-argument signature
 * does not change.
 */
export function attachApplicationContainer(application: object, container: AponiaContainer): void {
  Object.defineProperty(application, containerKey, {
    value: container,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/**
 * The container a boot attached, or `undefined` for an application no boot produced.
 *
 * Module-private: `readApplicationToken` is the seam's reader, and a future
 * consumer that needs the container itself can export this in the change that
 * reads it rather than in advance of one.
 */
function readApplicationContainer(application: unknown): AponiaContainer | undefined {
  return (application as { [containerKey]?: AponiaContainer } | null | undefined)?.[containerKey];
}

/**
 * @internal
 *
 * The value a token resolves to, through the container a boot attached.
 *
 * An application no boot produced holds no container and has no graph to find
 * the token in, which is the same fact `MISSING_PROVIDER` states — the code the
 * graph raises for a token nothing can resolve. The message says which of the
 * two it was.
 */
export function readApplicationToken<T>(application: unknown, token: Token<T>): T {
  const container = readApplicationContainer(application);
  if (!container) {
    throw new AponiaError(
      "MISSING_PROVIDER",
      `Provider "${tokenName(token)}" cannot be read: no boot produced this application, so it holds no container.`,
      { token: tokenName(token) },
    );
  }

  return container.get(token);
}
