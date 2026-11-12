import { resolveForwardRef } from "../modules/forward-ref.ts";
import type { InjectionDependency, InjectionToken, OptionalInjection } from "./token.types.ts";

/**
 * Mints an explicit injection token for a value no class names.
 *
 * A class is its own token; anything else — a string, a configuration object,
 * a function — needs one, because a type cannot be injected. Each call mints a
 * fresh `Symbol`, so two tokens with the same description never collide.
 *
 * @param description - The name failure messages and inspection report.
 * @returns A frozen token carried as the provider's `provide`.
 *
 * @example
 * ```ts
 * const appName = createToken<string>("app.name");
 * ```
 */
export function createToken<T>(description: string): InjectionToken<T> {
  return Object.freeze({
    id: Symbol(description),
    description,
  });
}

/**
 * Wraps a token so a missing provider resolves to `undefined`.
 *
 * `@Optional()` uses this for decorated constructors; descriptor authors use it
 * directly when they declare their own dependency lists.
 *
 * @param token - The token whose absence is allowed.
 * @returns A frozen optional injection wrapper.
 */
export function optionalDependency<T>(token: OptionalInjection<T>["token"]): OptionalInjection<T> {
  return Object.freeze({ token, optional: true });
}

/**
 * Whether a dependency declaration marks a provider as optional.
 *
 * @param dependency - The dependency to inspect.
 * @returns True for an optional injection wrapper.
 */
export function isOptionalInjection(dependency: unknown): dependency is OptionalInjection<unknown> {
  return (
    typeof dependency === "object" &&
    dependency !== null &&
    "optional" in dependency &&
    dependency.optional === true &&
    "token" in dependency
  );
}

/**
 * Reads the printable name of a token for failure messages.
 *
 * A class token answers its class name (or `"<anonymous class>"` when it has
 * none); every other token answers its description.
 *
 * @param token - The token to name.
 * @returns The name failure details carry.
 */
export function getTokenName(token: InjectionDependency): string {
  const dependency = isOptionalInjection(token) ? token.token : token;
  const unwrapped = resolveForwardRef(dependency);
  if (typeof unwrapped === "string") {
    return unwrapped;
  }
  if (typeof unwrapped === "symbol") {
    return unwrapped.description ?? String(unwrapped);
  }
  if (typeof unwrapped === "function") {
    return unwrapped.name || "<anonymous class>";
  }

  return unwrapped.description;
}
