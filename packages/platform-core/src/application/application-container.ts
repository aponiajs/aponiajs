import type { AponiaContainer } from "@aponiajs/core";

// A registered key rather than a fresh symbol: every platform package and every
// package that reads the boot's container must agree on it.
const containerKey: unique symbol = Symbol.for("aponia.application.container");

/**
 * Attaches the boot's container to the native application it produced.
 *
 * Non-enumerable and non-writable after the boot decides it. A native
 * application no boot produced reads as `undefined`.
 *
 * @internal
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
 * @internal
 */
export function getApplicationContainer(application: unknown): AponiaContainer | undefined {
  return (application as { [containerKey]?: AponiaContainer } | null | undefined)?.[containerKey];
}
