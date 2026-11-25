import { AponiaError } from "@aponiajs/common";
import type {
  LifetimeHandleController,
  LifetimeScopeOptions,
} from "../interfaces/lifetime.interface.ts";
import { Scoped } from "./scoped.ts";

/**
 * One revocable lifetime: a request, a transaction, or a background task.
 *
 * A scope owns tracked values and guarded objects. `exit()` is idempotent and
 * revokes child scopes first, so a parent's end cannot leave a still-readable
 * child behind.
 *
 * @example
 * ```ts
 * const scope = new LifetimeScope({ label: "request" });
 * const session = scope.track(await loadSession());
 * session.get();
 * scope.exit("response");
 * session.get(); // AponiaError("STALE_LIFETIME")
 * ```
 */
export class LifetimeScope implements LifetimeHandleController {
  readonly #label: string;
  readonly #parent: LifetimeScope | undefined;
  readonly #children = new Set<LifetimeScope>();
  #open = true;
  #exitReason: string | undefined;

  constructor(options: LifetimeScopeOptions = {}, parent?: LifetimeScope) {
    this.#label = options.label ?? "lifetime";
    this.#parent = parent;
  }

  /** The label failures carry. */
  get label(): string {
    return this.#label;
  }

  /** Whether the scope still admits work. */
  get isOpen(): boolean {
    return this.#open;
  }

  /** Why the scope exited, or `undefined` while it is open. */
  get exitReason(): string | undefined {
    return this.#exitReason;
  }

  /** The parent scope when this scope is a child. */
  get parent(): LifetimeScope | undefined {
    return this.#parent;
  }

  /**
   * Tracks a value under this scope.
   *
   * @param value - The value the returned handle owns.
   * @returns A handle readable only while this scope is open.
   * @throws An `AponiaError` with `STALE_LIFETIME` after the scope exits.
   */
  track<T>(value: T): Scoped<T> {
    this.assertOpen("track");
    return new Scoped(this, value);
  }

  /**
   * Guards a plain object with a top-level revocation proxy.
   *
   * The proxy forwards property reads with the target as receiver, so getters
   * and methods keep the target's `this`: `#private` fields and `WeakMap`
   * identity work without an `Illegal invocation`. A method read through the
   * proxy is invoked with `Reflect.apply(method, target, args)`. Article-level
   * behavior and the prototype chain are preserved; identity is not, and
   * nested values are not guarded.
   *
   * @param value - The plain object to guard.
   * @returns A proxy typed as the original object.
   * @throws A `TypeError` when the value is not a plain object.
   * @throws An `AponiaError` with `STALE_LIFETIME` after the scope exits.
   */
  guard<T extends object>(value: T): T {
    this.assertOpen("guard");
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError("LifetimeScope.guard() needs a plain object, not a function or array.");
    }

    const assertOpen = (operation: string): void => this.assertOpen(operation);
    return new Proxy(value, {
      get: (target, property) => {
        assertOpen("get");
        const result = Reflect.get(target, property, target);
        if (typeof result === "function" && !hasInvariantFunction(target, property)) {
          return (...args: unknown[]) => {
            assertOpen("call");
            return Reflect.apply(result, target, args);
          };
        }
        return result;
      },
      set: (target, property, newValue) => {
        assertOpen("set");
        return Reflect.set(target, property, newValue, target);
      },
      deleteProperty: (target, property) => {
        assertOpen("delete");
        return Reflect.deleteProperty(target, property);
      },
      defineProperty: (target, property, descriptor) => {
        assertOpen("define");
        return Reflect.defineProperty(target, property, descriptor);
      },
      has: (target, property) => {
        assertOpen("has");
        return Reflect.has(target, property);
      },
      ownKeys: (target) => {
        assertOpen("ownKeys");
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor: (target, property) => {
        assertOpen("getOwnPropertyDescriptor");
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
  }

  /**
   * Creates a child scope revoked with this one.
   *
   * @param options - The child's label.
   * @returns The child scope.
   * @throws An `AponiaError` with `STALE_LIFETIME` after this scope exits.
   */
  createChild(options: LifetimeScopeOptions = {}): LifetimeScope {
    this.assertOpen("createChild");
    const child = new LifetimeScope(options, this);
    this.#children.add(child);
    return child;
  }

  /**
   * Ends this scope and revokes every handle it owns.
   *
   * Idempotent: a second call keeps the first exit reason.
   *
   * @param reason - Why the scope ended; defaults to `"closed"`.
   */
  exit(reason = "closed"): void {
    if (!this.#open) {
      return;
    }
    this.#open = false;
    this.#exitReason = reason;
    for (const child of this.#children) {
      child.exit(reason);
    }
    this.#children.clear();
    if (this.#parent !== undefined) {
      this.#parent.#detach(this);
    }
  }

  /**
   * Refuses an operation once the scope exited.
   *
   * @param operation - The operation being attempted.
   * @throws An `AponiaError` with `STALE_LIFETIME` when the scope is closed.
   */
  assertOpen(operation: string): void {
    if (this.#open) {
      return;
    }
    throw new AponiaError(
      "STALE_LIFETIME",
      `The "${this.#label}" lifetime cannot ${operation} because it ended (${this.#exitReason ?? "closed"}).`,
      {
        label: this.#label,
        operation,
        reason: this.#exitReason ?? "closed",
      },
    );
  }

  #detach(child: LifetimeScope): void {
    this.#children.delete(child);
  }
}

/**
 * Whether a property is a non-configurable, non-writable data property.
 *
 * A proxy's `get` trap must return such a property's exact value, or the
 * runtime throws an invariant `TypeError`. That rule outranks binding the
 * method, so these functions are returned unwrapped.
 */
function hasInvariantFunction(target: object, property: string | symbol): boolean {
  const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
  return (
    descriptor !== undefined &&
    descriptor.configurable === false &&
    "value" in descriptor &&
    descriptor.writable === false
  );
}

/**
 * Opens a scope for one unit of work and exits it however the work settles.
 *
 * @param work - The work to run with the fresh scope.
 * @param options - The scope label.
 * @returns Whatever the work returns.
 *
 * @example
 * ```ts
 * const result = await withLifetime(async (scope) => {
 *   const handle = scope.track(await loadSession());
 *   return handle.get();
 * }, { label: "request" });
 * ```
 */
export async function withLifetime<T>(
  work: (scope: LifetimeScope) => T | Promise<T>,
  options: LifetimeScopeOptions = {},
): Promise<T> {
  const scope = new LifetimeScope(options);
  try {
    return await work(scope);
  } finally {
    scope.exit("lifetime-complete");
  }
}
