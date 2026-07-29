declare const tokenType: unique symbol;

export type Constructor<T, TArguments extends readonly unknown[] = readonly unknown[]> = new (
  ...arguments_: TArguments
) => T;

export type ClassToken<T> = abstract new (...arguments_: never[]) => T;

export interface InjectionToken<T> {
  readonly id: symbol;
  readonly description: string;
  readonly [tokenType]?: T;
}

export type Token<T> = ClassToken<T> | InjectionToken<T>;

export type TokenValue<TToken> = TToken extends Token<infer TValue> ? TValue : never;

export type TokenValues<TTokens extends readonly Token<unknown>[]> = {
  readonly [TIndex in keyof TTokens]: TokenValue<TTokens[TIndex]>;
};
