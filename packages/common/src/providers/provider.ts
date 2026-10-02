import type { ClassToken, Constructor, Token, TokenMap } from "../tokens/token.types.ts";
import type {
  AliasProvider,
  ClassProvider,
  FactoryProvider,
  ProviderScope,
  ValueProvider,
} from "./provider.types.ts";

export interface ProviderScopeOption {
  /**
   * The lifetime the instance is kept for.
   *
   * Only `"singleton"` is instantiated today; `"request"` and `"transient"`
   * are reserved and resolving one fails with `UNSUPPORTED_PROVIDER_SCOPE`
   * until the scope is implemented.
   */
  readonly scope?: ProviderScope;
}

export function provideValue<T>(
  provide: Token<T>,
  useValue: T,
  options: ProviderScopeOption = {},
): ValueProvider<T> {
  return Object.freeze({
    kind: "value",
    provide,
    useValue,
    ...(options.scope === undefined ? {} : { scope: options.scope }),
  });
}

export function provideFactory<T, const TDependencies extends readonly Token<unknown>[]>(
  provide: Token<T>,
  inject: TDependencies,
  useFactory: (...dependencies: TokenMap<TDependencies>) => T,
  options: ProviderScopeOption = {},
): FactoryProvider<T, TDependencies> {
  return Object.freeze({
    kind: "factory",
    provide,
    inject,
    useFactory,
    ...(options.scope === undefined ? {} : { scope: options.scope }),
  });
}

/**
 * Registers a class as a provider.
 *
 * The two-argument form binds the class to its own token, so an instance is
 * reachable by the class. The three-argument form binds it to a different token,
 * which is how an implementation is placed behind an interface token:
 *
 * ```ts
 * provideClass(UsersService, []);
 * provideClass(USERS_REPOSITORY, SqlUsersRepository, [Database]);
 * ```
 *
 * In both forms `provide` is the token the container keys the instance by and
 * `inject` is the dependency list `getProviderDependencies` reports, so a bound
 * class resolves exactly like one registered under its own token.
 */
export function provideClass<T, const TDependencies extends readonly Token<unknown>[]>(
  useClass: ClassToken<T> & Constructor<T, TokenMap<TDependencies>>,
  inject: TDependencies,
  options?: ProviderScopeOption,
): ClassProvider<T, TDependencies>;
export function provideClass<T, const TDependencies extends readonly Token<unknown>[]>(
  provide: Token<T>,
  useClass: Constructor<T, TokenMap<TDependencies>>,
  inject: TDependencies,
  options?: ProviderScopeOption,
): ClassProvider<T, TDependencies>;
export function provideClass<T, const TDependencies extends readonly Token<unknown>[]>(
  provideOrClass: Token<T>,
  classOrInject: TDependencies | Constructor<T, TokenMap<TDependencies>>,
  injected?: TDependencies | ProviderScopeOption,
  options?: ProviderScopeOption,
): ClassProvider<T, TDependencies> {
  if (injected === undefined || !Array.isArray(injected)) {
    const useClass = provideOrClass as ClassToken<T> & Constructor<T, TokenMap<TDependencies>>;
    const scope = (injected as ProviderScopeOption | undefined)?.scope;
    return Object.freeze({
      kind: "class",
      provide: useClass,
      inject: classOrInject as TDependencies,
      useClass,
      ...(scope === undefined ? {} : { scope }),
    }) as ClassProvider<T, TDependencies>;
  }

  const scope = options?.scope;
  return Object.freeze({
    kind: "class",
    provide: provideOrClass,
    inject: injected,
    useClass: classOrInject as Constructor<T, TokenMap<TDependencies>>,
    ...(scope === undefined ? {} : { scope }),
  }) as ClassProvider<T, TDependencies>;
}

export function provideAlias<T>(
  provide: Token<T>,
  useExisting: Token<T>,
  options: ProviderScopeOption = {},
): AliasProvider<T> {
  return Object.freeze({
    kind: "alias",
    provide,
    useExisting,
    ...(options.scope === undefined ? {} : { scope: options.scope }),
  });
}
