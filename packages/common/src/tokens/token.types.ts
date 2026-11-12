import type { ForwardReference } from "../modules/forward-ref.types.ts";

declare const tokenType: unique symbol;

/** A constructor signature factories accept as a dependency list shape. */
export type Constructor<T, TArguments extends readonly unknown[] = readonly unknown[]> = new (
  ...arguments_: TArguments
) => T;

/** A class usable as its own injection token. */
export type ClassToken<T> = abstract new (...arguments_: never[]) => T;

/**
 * An explicit injection token minted by {@link createToken}.
 *
 * The phantom `tokenType` member carries the value type so the token reads as
 * the type it resolves to, with no runtime field behind it.
 */
export interface InjectionToken<T> {
  readonly id: symbol;
  readonly description: string;
  readonly [tokenType]?: T;
}

/**
 * Anything the container resolves by: a class, an explicit token, or a
 * Nest-style string/symbol token.
 *
 * A bare string resolves to `unknown` because it carries no value type; prefer
 * `createToken` or a class when the type matters.
 */
export type Token<T> = string | symbol | ClassToken<T> | InjectionToken<T>;

/** A dependency whose absence resolves to `undefined` instead of failing the boot. */
export interface OptionalInjection<T = unknown> {
  /** The token that is resolved when it is visible. */
  readonly token: Token<T> | ForwardReference<Token<T>>;
  /** Marks the dependency as optional. */
  readonly optional: true;
}

/** Any dependency injectable into a provider or controller: a token, a forward reference, or an optional wrapper. */
export type InjectionDependency<T = unknown> =
  | Token<T>
  | ForwardReference<Token<T>>
  | OptionalInjection<T>;

/** The value type a token resolves to. */
export type TokenValue<TToken> =
  TToken extends OptionalInjection<infer TValue>
    ? TValue | undefined
    : TToken extends Token<infer TValue>
      ? TValue
      : TToken extends ForwardReference<Token<infer TValue>>
        ? TValue
        : never;

/** The tuple of value types a dependency list resolves to, in order. */
export type TokenMap<TTokens extends readonly unknown[]> = {
  readonly [TIndex in keyof TTokens]: TokenValue<TTokens[TIndex]>;
};
