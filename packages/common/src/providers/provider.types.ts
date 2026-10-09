import type { Constructor, InjectionDependency, Token, TokenMap } from "../tokens/token.types.ts";
import type { Scope } from "./provider.constants.ts";

/**
 * The lifetime a provider instance is kept for: singleton, request, or transient.
 */
export type ProviderScope = (typeof Scope)[keyof typeof Scope];

interface ProviderBase<T> {
  readonly provide: Token<T>;
  readonly scope?: ProviderScope;
}

/** A value provider: the token resolves to an existing value as-is. */
export interface ValueProvider<T> extends ProviderBase<T> {
  readonly kind: "value";
  readonly useValue: T;
}

/** A factory provider: the container calls the factory once with its resolved dependencies. */
export interface FactoryProvider<
  T,
  TDependencies extends readonly InjectionDependency[] = readonly InjectionDependency[],
> extends ProviderBase<T> {
  readonly kind: "factory";
  readonly inject: TDependencies;
  readonly useFactory: (...dependencies: TokenMap<TDependencies>) => T;
}

/** A class provider: the container constructs the class with its resolved dependencies. */
export interface ClassProvider<
  T,
  TDependencies extends readonly InjectionDependency[] = readonly InjectionDependency[],
> extends ProviderBase<T> {
  readonly kind: "class";
  readonly inject: TDependencies;
  readonly useClass: Constructor<T, TokenMap<TDependencies>>;
}

/** An alias provider: the token resolves to whatever another token resolves to. */
export interface AliasProvider<T> extends ProviderBase<T> {
  readonly kind: "alias";
  readonly useExisting: Token<T>;
}

/**
 * Anything a module's `providers` accepts: a value, a factory, a class, or
 * an alias. Each arm carries an optional `scope` naming the lifetime the
 * instance is kept for; only `"singleton"` instantiates today.
 */
export type Provider =
  | {
      readonly kind: "value";
      readonly provide: Token<unknown>;
      readonly useValue: unknown;
      readonly scope?: ProviderScope;
    }
  | {
      readonly kind: "factory";
      readonly provide: Token<unknown>;
      readonly inject: readonly InjectionDependency[];
      readonly useFactory: (...dependencies: never[]) => unknown;
      readonly scope?: ProviderScope;
    }
  | {
      readonly kind: "class";
      readonly provide: Token<unknown>;
      readonly inject: readonly InjectionDependency[];
      readonly useClass: Constructor<unknown, never[]>;
      readonly scope?: ProviderScope;
    }
  | {
      readonly kind: "alias";
      readonly provide: Token<unknown>;
      readonly useExisting: Token<unknown>;
      readonly scope?: ProviderScope;
    };
