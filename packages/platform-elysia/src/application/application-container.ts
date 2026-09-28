import { AponiaError, tokenName, type Token } from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";

// A registered key rather than a fresh symbol: two copies of this package in one
// graph must agree on it, the same reason the boot record registers its own.
const containerKey: unique symbol = Symbol.for("aponia.application.container");

// The store's own key, registered for the same reason. It rides the application's
// `store` rather than the application, which is the one difference between this
// seam and the two beside it — see `publishApplicationOnStore`.
const nativeApplicationKey: unique symbol = Symbol.for("aponia.application.native");

// Every export below is internal: none appears in this package's barrel except
// `readApplicationFromStore`, whose one consumer is another framework package
// rather than an application, and the marker is what keeps a future `export *`
// from publishing the rest.

/**
 * Attaches the boot's container to the application it produced.
 *
 * Non-enumerable because Elysia composes by walking an instance's keys,
 * non-writable so nothing overwrites the decision a boot made, and
 * non-configurable so nothing undoes it. An application no boot produced must
 * read as `undefined` rather than as an empty container. Rides a symbol rather
 * than a constructor parameter so the wrapper's exported two-argument signature
 * does not change.
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
 * Module-private: `readApplicationToken` is the seam's reader, and a future
 * consumer that needs the container itself can export this in the change that
 * reads it rather than in advance of one.
 */
function readApplicationContainer(application: unknown): AponiaContainer | undefined {
  return (application as { [containerKey]?: AponiaContainer } | null | undefined)?.[containerKey];
}

/**
 * The value a token resolves to, through the container a boot attached.
 *
 * An application no boot produced holds no container and has no graph to find
 * the token in, which is the same fact `MISSING_PROVIDER` states — the code the
 * graph raises for a token nothing can resolve. The message says which of the
 * two it was.
 *
 * @internal
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

/**
 * Publishes the application on its own `store`, so a plugin mounted on it can
 * reach it while answering a request.
 *
 * The two seams above ride the application and are read by whoever holds it.
 * This one exists for the caller that does not: Elysia's request context carries
 * `store` and never the instance, and `onStart` — the only hook handed the
 * instance — does not run for an application that never listens, so a plugin
 * that needs the application at request time has no other channel to read it
 * from. `context.store` is the same object as `application.store` — Elysia hands
 * one root store to both — which is what makes the publication visible there.
 *
 * The entry is non-enumerable, so it stays out of the store's own shape, and
 * non-writable and non-configurable for the reason the container seam states:
 * nothing overwrites or undoes the decision a boot made. Unlike the instance
 * seams it is a store entry rather than a property of the application, because
 * the reader is on the other side of a request rather than holding the instance.
 *
 * @internal
 */
export function publishApplicationOnStore(application: object): void {
  const store = (application as { store?: Record<PropertyKey, unknown> }).store;
  if (!store) {
    return;
  }

  Object.defineProperty(store, nativeApplicationKey, {
    value: application,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/**
 * The application a request is being answered by, or `undefined` when nothing
 * published one.
 *
 * `undefined` is the answer for an application no boot produced — a plain
 * `Elysia` a plugin was mounted on by hand — and a consumer reports that absence
 * rather than treating it as an error, exactly as `readApplicationDiagnostics`
 * does with the record. It is the channel `@aponiajs/devtools` reaches the
 * application through, which is why this one reader is on the barrel.
 *
 * @internal
 */
export function readApplicationFromStore(store: unknown): object | undefined {
  return (store as Record<PropertyKey, unknown> | null | undefined)?.[nativeApplicationKey] as
    | object
    | undefined;
}
