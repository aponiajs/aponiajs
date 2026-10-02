import type { Constructor, Token, TokenMap } from "../tokens/token.types.ts";

/**
 * The lifetime a provider instance is kept for.
 *
 * Only `"singleton"` is instantiated today: one instance per provider per
 * module, created at boot. `"request"` and `"transient"` are reserved so a
 * declaration can state the lifetime it needs before the container honors it —
 * resolving a provider that names either fails with
 * `UNSUPPORTED_PROVIDER_SCOPE` until the scope is implemented, rather than
 * silently serving a singleton where a fresh instance was promised.
 */
export type ProviderScope = "singleton" | "request" | "transient";

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
  readonly useFactory: (...dependencies: TokenMap<TDependencies>) => T;
}

export interface ClassProvider<
  T,
  TDependencies extends readonly Token<unknown>[] = readonly Token<unknown>[],
> extends ProviderBase<T> {
  readonly kind: "class";
  readonly inject: TDependencies;
  readonly useClass: Constructor<T, TokenMap<TDependencies>>;
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
      readonly scope?: ProviderScope;
    }
  | {
      readonly kind: "factory";
      readonly provide: Token<unknown>;
      readonly inject: readonly Token<unknown>[];
      readonly useFactory: (...dependencies: never[]) => unknown;
      readonly scope?: ProviderScope;
    }
  | {
      readonly kind: "class";
      readonly provide: Token<unknown>;
      readonly inject: readonly Token<unknown>[];
      readonly useClass: Constructor<unknown, never[]>;
      readonly scope?: ProviderScope;
    }
  | {
      readonly kind: "alias";
      readonly provide: Token<unknown>;
      readonly useExisting: Token<unknown>;
      readonly scope?: ProviderScope;
    };
