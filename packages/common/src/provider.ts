import type { ClassToken, Constructor, Token, TokenValues } from "./token.ts";

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

export function provideValue<T>(provide: Token<T>, useValue: T): ValueProvider<T> {
  return Object.freeze({
    kind: "value",
    provide,
    useValue,
  });
}

export function provideFactory<T, const TDependencies extends readonly Token<unknown>[]>(
  provide: Token<T>,
  inject: TDependencies,
  useFactory: (...dependencies: TokenValues<TDependencies>) => T,
): FactoryProvider<T, TDependencies> {
  return Object.freeze({
    kind: "factory",
    provide,
    inject,
    useFactory,
  });
}

export function provideClass<T, const TDependencies extends readonly Token<unknown>[]>(
  useClass: ClassToken<T> & Constructor<T, TokenValues<TDependencies>>,
  inject: TDependencies,
): ClassProvider<T, TDependencies> {
  return Object.freeze({
    kind: "class",
    provide: useClass,
    inject,
    useClass,
  });
}

export function provideAlias<T>(provide: Token<T>, useExisting: Token<T>): AliasProvider<T> {
  return Object.freeze({
    kind: "alias",
    provide,
    useExisting,
  });
}
