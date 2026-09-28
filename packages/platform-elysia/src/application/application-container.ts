import { AponiaError, type Token } from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";

const containerKey: unique symbol = Symbol.for("aponia.application.container");

/**
 * Attaches the boot's container to the application it produced.
 *
 * The property is non-enumerable, non-writable, and non-configurable for the
 * same reason the boot record's is: Elysia composes by walking an instance's
 * keys, and an application no boot produced must read as `undefined` rather than
 * as an empty container. Rides a symbol rather than a constructor parameter so
 * the wrapper's exported two-argument signature does not change.
 */
export function attachApplicationContainer(application: object, container: AponiaContainer): void {
  Object.defineProperty(application, containerKey, {
    value: container,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/** The container a boot attached, or `undefined` for an application no boot produced. */
export function readApplicationContainer(application: unknown): AponiaContainer | undefined {
  return (application as { [containerKey]?: AponiaContainer } | null | undefined)?.[containerKey];
}

/**
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
      `Provider "${String(token)}" cannot be read: no boot produced this application, so it holds no container.`,
      { token: String(token) },
    );
  }

  return container.get(token);
}
