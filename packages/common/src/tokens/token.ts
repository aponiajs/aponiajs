import type { InjectionToken, Token } from "./token.types.ts";

export function createToken<T>(description: string): InjectionToken<T> {
  return Object.freeze({
    id: Symbol(description),
    description,
  });
}

export function tokenName(token: Token<unknown>): string {
  if (typeof token === "function") {
    return token.name || "<anonymous class>";
  }

  return token.description;
}
