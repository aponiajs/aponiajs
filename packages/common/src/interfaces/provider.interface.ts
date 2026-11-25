import type {
  ClassToken,
  Constructor,
  InjectionDependency,
  Token,
  TokenMap,
} from "./token.interface.ts";
import type { ProviderScope } from "../providers/provider.constants.ts";

export type {
  LegacyProviderScope,
  NormalizedProviderScope,
  ProviderScope,
  Scope,
} from "../providers/provider.constants.ts";

interface ProviderBase<T> {
  readonly provide: Token<T>;
  readonly scope?: ProviderScope;
  /**
   * Groups request-scoped instances by the parent context id a registered
   * `ContextIdStrategy` resolves.
   *
   * Only meaningful with `scope: Scope.REQUEST`; a durable provider's instance
   * is shared by every request the strategy maps to one parent id.
   */
  readonly durable?: boolean;
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
  readonly useFactory: (...dependencies: TokenMap<TDependencies>) => T | Promise<T>;
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
      readonly durable?: boolean;
    }
  | {
      readonly kind: "factory";
      readonly provide: Token<unknown>;
      readonly inject: readonly InjectionDependency[];
      readonly useFactory: (...dependencies: never[]) => unknown;
      readonly scope?: ProviderScope;
      readonly durable?: boolean;
    }
  | {
      readonly kind: "class";
      readonly provide: Token<unknown>;
      readonly inject: readonly InjectionDependency[];
      readonly useClass: Constructor<unknown, never[]>;
      readonly scope?: ProviderScope;
      readonly durable?: boolean;
    }
  | {
      readonly kind: "alias";
      readonly provide: Token<unknown>;
      readonly useExisting: Token<unknown>;
      readonly scope?: ProviderScope;
      readonly durable?: boolean;
    };

/**
 * A Nest-shaped provider literal.
 *
 * `normalizeProvider` lowers it to the canonical `Provider` union. `inject`
 * defaults to an empty list; the platform infers a decorated class's
 * constructor dependencies when the literal omits it.
 */
export type NestProvider =
  | {
      readonly provide: Token<unknown>;
      readonly useValue: unknown;
      readonly scope?: ProviderScope;
      readonly durable?: boolean;
    }
  | {
      readonly provide: Token<unknown>;
      readonly useFactory: (...dependencies: never[]) => unknown;
      readonly inject?: readonly InjectionDependency[];
      readonly scope?: ProviderScope;
      readonly durable?: boolean;
    }
  | {
      readonly provide: Token<unknown>;
      readonly useClass: ClassToken<unknown> | Constructor<unknown, never[]>;
      readonly inject?: readonly InjectionDependency[];
      readonly scope?: ProviderScope;
      readonly durable?: boolean;
    }
  | {
      readonly provide: Token<unknown>;
      readonly useExisting: Token<unknown>;
      readonly scope?: ProviderScope;
      readonly durable?: boolean;
    };
