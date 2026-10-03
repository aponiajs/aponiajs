import type { InjectionToken, Token } from "./token.types.ts";

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
 * Reads the printable name of a token for failure messages.
 *
 * A class token answers its class name (or `"<anonymous class>"` when it has
 * none); every other token answers its description.
 *
 * @param token - The token to name.
 * @returns The name failure details carry.
 */
export function getTokenName(token: Token<unknown>): string {
  if (typeof token === "function") {
    return token.name || "<anonymous class>";
  }

  return token.description;
}
