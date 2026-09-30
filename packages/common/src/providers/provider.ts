import type { ClassToken, Constructor, Token, TokenValues } from "../tokens/token.types.ts";
import type {
  AliasProvider,
  ClassProvider,
  FactoryProvider,
  ValueProvider,
} from "./provider.types.ts";

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
 * `inject` is the dependency list `providerDependencies` reports, so a bound
 * class resolves exactly like one registered under its own token.
 */
export function provideClass<T, const TDependencies extends readonly Token<unknown>[]>(
  useClass: ClassToken<T> & Constructor<T, TokenValues<TDependencies>>,
  inject: TDependencies,
): ClassProvider<T, TDependencies>;
export function provideClass<T, const TDependencies extends readonly Token<unknown>[]>(
  provide: Token<T>,
  useClass: Constructor<T, TokenValues<TDependencies>>,
  inject: TDependencies,
): ClassProvider<T, TDependencies>;
export function provideClass<T, const TDependencies extends readonly Token<unknown>[]>(
  provideOrClass: Token<T>,
  classOrInject: TDependencies | Constructor<T, TokenValues<TDependencies>>,
  injected?: TDependencies,
): ClassProvider<T, TDependencies> {
  if (injected === undefined) {
    const useClass = provideOrClass as ClassToken<T> & Constructor<T, TokenValues<TDependencies>>;
    return Object.freeze({
      kind: "class",
      provide: useClass,
      inject: classOrInject as TDependencies,
      useClass,
    });
  }

  return Object.freeze({
    kind: "class",
    provide: provideOrClass,
    inject: injected,
    useClass: classOrInject as Constructor<T, TokenValues<TDependencies>>,
  });
}

export function provideAlias<T>(provide: Token<T>, useExisting: Token<T>): AliasProvider<T> {
  return Object.freeze({
    kind: "alias",
    provide,
    useExisting,
  });
}
