import { AponiaError } from "@aponiajs/common";
import type { DeepReadonly } from "./borrow.types.ts";

/** The shared revocation state of every proxy one borrow produced. */
export interface BorrowViewState {
  /** Set when the borrow released; every captured proxy then refuses. */
  revoked: boolean;
  /** The label failures carry. */
  readonly label: string;
  /** One proxy per raw object, so a nested value keeps its view identity. */
  readonly proxies: WeakMap<object, object>;
}

const readonlyArrayMutators = new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

/** Creates the shared state one borrow's views read. */
export function createBorrowViewState(label: string): BorrowViewState {
  return { revoked: false, label, proxies: new WeakMap<object, object>() };
}

/** Whether a value is a plain object, an array, or a null-prototype record. */
function isPlainData(value: unknown): value is object {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function assertView(state: BorrowViewState, operation: string): void {
  if (state.revoked) {
    throw new AponiaError(
      "STALE_LIFETIME",
      `The borrowed view for "${state.label}" cannot ${operation} because the borrow was released.`,
      {
        label: state.label,
        operation,
        reason: "released",
      },
    );
  }
}

function readonlyRefusal(state: BorrowViewState, operation: string, property?: PropertyKey): never {
  throw new AponiaError(
    "READONLY_VIEW",
    `The borrowed read view for "${state.label}" cannot ${operation}${property === undefined ? "" : ` property "${String(property)}"`}.`,
    {
      label: state.label,
      operation,
      ...(property === undefined ? {} : { property: String(property) }),
    },
  );
}

/**
 * Builds a deep revocable read view over a plain object or array.
 *
 * Property writes and every mutating array method throw `READONLY_VIEW`; a
 * captured proxy throws `STALE_LIFETIME` once the borrow releases. `Map`, `Set`,
 * `Date`, and class instances are passed by reference and are readonly at the
 * type level only.
 *
 * @internal
 */
export function createReadonlyView<T>(value: T, state: BorrowViewState): DeepReadonly<T> {
  return wrapReadonly(value, state) as DeepReadonly<T>;
}

/**
 * Builds a deep revocable exclusive view over a plain object or array.
 *
 * A captured proxy throws `STALE_LIFETIME` once the borrow releases.
 *
 * @internal
 */
export function createExclusiveView<T>(value: T, state: BorrowViewState): T {
  return wrapExclusive(value, state) as T;
}

function wrapReadonly(value: unknown, state: BorrowViewState): unknown {
  if (!isPlainData(value)) {
    return value;
  }
  const cached = state.proxies.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const proxy = new Proxy(value, {
    get(target, property) {
      assertView(state, "read");
      if (
        Array.isArray(target) &&
        typeof property === "string" &&
        readonlyArrayMutators.has(property)
      ) {
        return () => readonlyRefusal(state, "call", property);
      }
      return wrapReadonly(Reflect.get(target, property, target), state);
    },
    set(_target, property) {
      return readonlyRefusal(state, "write", property);
    },
    deleteProperty(_target, property) {
      return readonlyRefusal(state, "delete", property);
    },
    defineProperty(_target, property) {
      return readonlyRefusal(state, "define", property);
    },
    setPrototypeOf() {
      return readonlyRefusal(state, "setPrototypeOf");
    },
  });
  state.proxies.set(value, proxy);
  return proxy;
}

function wrapExclusive(value: unknown, state: BorrowViewState): unknown {
  if (!isPlainData(value)) {
    return value;
  }
  const cached = state.proxies.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const proxy = new Proxy(value, {
    get(target, property) {
      assertView(state, "read");
      return wrapExclusive(Reflect.get(target, property, target), state);
    },
    set(target, property, newValue) {
      assertView(state, "write");
      return Reflect.set(target, property, newValue, target);
    },
    deleteProperty(target, property) {
      assertView(state, "delete");
      return Reflect.deleteProperty(target, property);
    },
    defineProperty(target, property, descriptor) {
      assertView(state, "define");
      return Reflect.defineProperty(target, property, descriptor);
    },
    setPrototypeOf(target, prototype) {
      assertView(state, "setPrototypeOf");
      return Reflect.setPrototypeOf(target, prototype);
    },
  });
  state.proxies.set(value, proxy);
  return proxy;
}
