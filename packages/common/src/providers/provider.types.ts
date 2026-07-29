import type { Constructor, Token, TokenValues } from "../tokens/token.types.ts";

export type ProviderScope = "singleton";

interface ProviderBase<T> {
  readonly provide: Token<T>;
  readonly scope?: ProviderScope;
}

export interface ValueProvider<T> extends ProviderBase<T> {
  readonly kind: "value";
  readonly useValue: T;
}

export interface FactoryProvider<
  T,
  TDependencies extends readonly Token<unknown>[] = readonly Token<unknown>[],
> extends ProviderBase<T> {
  readonly kind: "factory";
  readonly inject: TDependencies;
  readonly useFactory: (...dependencies: TokenValues<TDependencies>) => T;
}

export interface ClassProvider<
  T,
  TDependencies extends readonly Token<unknown>[] = readonly Token<unknown>[],
> extends ProviderBase<T> {
  readonly kind: "class";
  readonly inject: TDependencies;
  readonly useClass: Constructor<T, TokenValues<TDependencies>>;
}

export interface AliasProvider<T> extends ProviderBase<T> {
  readonly kind: "alias";
  readonly useExisting: Token<T>;
}

export type Provider =
  | {
      readonly kind: "value";
      readonly provide: Token<unknown>;
      readonly useValue: unknown;
    }
  | {
      readonly kind: "factory";
      readonly provide: Token<unknown>;
      readonly inject: readonly Token<unknown>[];
      readonly useFactory: (...dependencies: never[]) => unknown;
    }
  | {
      readonly kind: "class";
      readonly provide: Token<unknown>;
      readonly inject: readonly Token<unknown>[];
      readonly useClass: Constructor<unknown, never[]>;
    }
  | {
      readonly kind: "alias";
      readonly provide: Token<unknown>;
      readonly useExisting: Token<unknown>;
    };
