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

/** Anything the container resolves by: a class, or an explicit token. */
export type Token<T> = ClassToken<T> | InjectionToken<T>;

/** The value type a token resolves to. */
export type TokenValue<TToken> = TToken extends Token<infer TValue> ? TValue : never;

/** The tuple of value types a dependency list resolves to, in order. */
export type TokenMap<TTokens extends readonly Token<unknown>[]> = {
  readonly [TIndex in keyof TTokens]: TokenValue<TTokens[TIndex]>;
};
