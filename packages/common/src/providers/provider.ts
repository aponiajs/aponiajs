import type {
  ClassToken,
  Constructor,
  InjectionDependency,
  Token,
  TokenMap,
} from "../tokens/token.types.ts";
import type {
  AliasProvider,
  ClassProvider,
  FactoryProvider,
  NestProvider,
  Provider,
  ProviderScope,
  ValueProvider,
} from "./provider.types.ts";
import { AponiaError } from "../errors/aponia-error.ts";

/**
 * Lowers a Nest-shaped provider literal to the canonical `Provider` union.
 *
 * A value already carrying `kind` passes through. `useClass` without `inject`
 * states no dependencies here; the platform lowering infers a decorated
 * class's constructor list before calling this, so a descriptor written by hand
 * should state `inject` explicitly.
 *
 * @internal
 */
export function normalizeProvider(provider: Provider | NestProvider): Provider {
  if ("kind" in provider) {
    return provider;
  }
  const options = provider.scope === undefined ? {} : { scope: provider.scope };
  if ("useValue" in provider) {
    return provideValue(provider.provide, provider.useValue, options);
  }
  if ("useExisting" in provider) {
    return provideAlias(provider.provide, provider.useExisting, options);
  }
  if ("useFactory" in provider) {
    return provideFactory(
      provider.provide,
      provider.inject ?? [],
      provider.useFactory as unknown as (...dependencies: readonly unknown[]) => unknown,
      options,
    ) as Provider;
  }
  if ("useClass" in provider) {
    return provideClass(
      provider.provide,
      provider.useClass as unknown as Constructor<unknown, readonly unknown[]>,
      provider.inject ?? [],
      options,
    ) as Provider;
  }
  throw new AponiaError(
    "INVALID_PROVIDER",
    "A provider must state kind, useValue, useClass, useFactory, or useExisting.",
  );
}

/** The trailing options every `provide*` factory accepts. */
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

/**
 * Registers an existing value under a token.
 *
 * The value is used as-is: the container never clones or constructs it, and
 * the same reference answers every resolution of the token.
 *
 * @param provide - The token resolutions of this provider answer.
 * @param useValue - The value the token resolves to.
 * @param options - The provider options; `scope` names the lifetime the
 * instance is kept for.
 * @returns A frozen value provider the module's `providers` accepts.
 *
 * @example
 * ```ts
 * const token = createToken<string>("app.name");
 * const provider = provideValue(token, "my-api");
 * ```
 */
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

/**
 * Registers a factory the container calls once with its resolved dependencies.
 *
 * The factory runs the first time the token resolves, and the singleton
 * instance it returns answers every later resolution.
 *
 * @param provide - The token resolutions of this provider answer.
 * @param inject - The tokens resolved and passed to `useFactory`, in order.
 * @param useFactory - Builds the value from the resolved dependencies.
 * @param options - The provider options; `scope` names the lifetime the
 * instance is kept for.
 * @returns A frozen factory provider the module's `providers` accepts.
 *
 * @example
 * ```ts
 * const greeting = provideFactory(GREETING, [APP_NAME], (name) => `Hello from ${name}`);
 * ```
 */
export function provideFactory<T, const TDependencies extends readonly InjectionDependency[]>(
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
 * Registers a class as a provider, bound to its own token.
 *
 * The instance is reachable by the class itself.
 *
 * @param useClass - The class to construct.
 * @param inject - The dependency list `getProviderDependencies` reports.
 * @param options - The provider options; `scope` names the lifetime the
 * instance is kept for.
 * @returns A frozen class provider the module's `providers` accepts.
 *
 * @example
 * ```ts
 * provideClass(UsersService, []);
 * ```
 */
export function provideClass<T, const TDependencies extends readonly InjectionDependency[]>(
  useClass: ClassToken<T> & Constructor<T, TokenMap<TDependencies>>,
  inject: TDependencies,
  options?: ProviderScopeOption,
): ClassProvider<T, TDependencies>;
/**
 * Registers a class as a provider, bound to a different token.
 *
 * This is how an implementation stands behind an interface token: `provide`
 * is the token the container keys the instance by and `inject` is the
 * dependency list the construction resolves.
 *
 * @param provide - The token the container keys the instance by.
 * @param useClass - The class to construct.
 * @param inject - The dependency list `getProviderDependencies` reports.
 * @param options - The provider options; `scope` names the lifetime the
 * instance is kept for.
 * @returns A frozen class provider the module's `providers` accepts.
 *
 * @example
 * ```ts
 * provideClass(USERS_REPOSITORY, SqlUsersRepository, [Database]);
 * ```
 */
export function provideClass<T, const TDependencies extends readonly InjectionDependency[]>(
  provide: Token<T>,
  useClass: Constructor<T, TokenMap<TDependencies>>,
  inject: TDependencies,
  options?: ProviderScopeOption,
): ClassProvider<T, TDependencies>;
export function provideClass<T, const TDependencies extends readonly InjectionDependency[]>(
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

/**
 * Points one token at another, so both resolve to the same instance.
 *
 * The alias declares no instance of its own: resolution follows `useExisting
 * ` and answers whatever that token resolves to.
 *
 * @param provide - The token resolutions of this provider answer.
 * @param useExisting - The token the resolution follows.
 * @param options - The provider options; `scope` names the lifetime the
 * instance is kept for.
 * @returns A frozen alias provider the module's `providers` accepts.
 *
 * @example
 * ```ts
 * const provider = provideAlias(LEGACY_GREETING, GREETING);
 * ```
 */
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
