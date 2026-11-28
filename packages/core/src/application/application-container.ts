import { createToken } from "@aponiajs/common";
import type { AponiaContainer } from "../injector/container.ts";

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

/**
 * The boot's container, reachable from a provider.
 *
 * The container a boot builds is what a package's provider needs to discover
 * the graph, and it does not exist when the provider list is written. The boot
 * provides this holder first and fills `current` immediately after the
 * container is created, before any module initializes.
 *
 * @internal
 */
export interface ApplicationContainerRef {
  current?: AponiaContainer | undefined;
}

/**
 * The token carrying the boot's container reference.
 * @internal
 */
export const APPLICATION_CONTAINER = createToken<ApplicationContainerRef>(
  "aponia.application.container-reference",
);

/**
 * Creates the holder a boot fills once its container exists.
 *
 * @internal
 */
export function createApplicationContainerRef(): ApplicationContainerRef {
  return {};
}
