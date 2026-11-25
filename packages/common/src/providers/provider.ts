import type {
  ClassToken,
  Constructor,
  InjectionDependency,
  Token,
  TokenMap,
} from "../interfaces/token.interface.ts";
import type {
  AliasProvider,
  ClassProvider,
  FactoryProvider,
  NestProvider,
  Provider,
  ProviderScope,
  ValueProvider,
} from "../interfaces/provider.interface.ts";
import {
  Scope,
  type LegacyProviderScope,
  type NormalizedProviderScope,
} from "./provider.constants.ts";
import { Logger } from "../services/console-logger.service.ts";
import { AponiaError } from "../exceptions/aponia-error.ts";

const legacyScopeNames: Readonly<Record<LegacyProviderScope, NormalizedProviderScope>> =
  Object.freeze({
    singleton: "singleton",
    request: "request",
    transient: "transient",
  });

const warnedLegacyScopes = new Set<LegacyProviderScope>();

/**
 * Lowers a declared scope to the lifetime the container runs.
 *
 * Nest's numeric `Scope` values pass through unchanged. The legacy string
 * spellings are accepted for one release, lowered to the same lifetimes, and
 * reported once per spelling; a value this release cannot honor is returned
 * unchanged so the graph raises `UNSUPPORTED_PROVIDER_SCOPE` with the original.
 *
 * @param scope - The scope a provider or controller declares.
 * @returns The normalized lifetime.
 */
export function normalizeProviderScope(scope: ProviderScope | undefined): NormalizedProviderScope {
  if (scope === undefined) {
    return "singleton";
  }
  if (typeof scope === "string") {
    const normalized = legacyScopeNames[scope];
    if (normalized !== undefined) {
      warnLegacyScope(scope, normalized);
      return normalized;
    }
    return scope as unknown as NormalizedProviderScope;
  }
  switch (scope) {
    case Scope.DEFAULT:
      return "singleton";
    case Scope.REQUEST:
      return "request";
    case Scope.TRANSIENT:
      return "transient";
    default:
      return scope as unknown as NormalizedProviderScope;
  }
}

function warnLegacyScope(scope: LegacyProviderScope, normalized: NormalizedProviderScope): void {
  if (warnedLegacyScopes.has(scope)) {
    return;
  }
  warnedLegacyScopes.add(scope);
  new Logger("Scope").warn(
    `Provider scope "${scope}" is deprecated; use Scope.${normalized === "singleton" ? "DEFAULT" : normalized.toUpperCase()} (${Scope[normalized === "singleton" ? "DEFAULT" : normalized === "request" ? "REQUEST" : "TRANSIENT"]}) instead.`,
  );
}

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
  const options: ProviderScopeOption = {
    ...(provider.scope === undefined ? {} : { scope: provider.scope }),
    ...(provider.durable === undefined ? {} : { durable: provider.durable }),
  };
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
  /** The lifetime the instance is kept for. */
  readonly scope?: ProviderScope;
  /** Shares a request-scoped instance by the parent context id a strategy resolves. */
  readonly durable?: boolean;
}

/** The scope and durability fields a provider record carries. */
function scopeFields(options: ProviderScopeOption): {
  readonly scope?: ProviderScope;
  readonly durable?: boolean;
} {
  return {
    ...(options.scope === undefined
      ? {}
      : { scope: scopeValue(normalizeProviderScope(options.scope)) }),
    ...(options.durable === undefined ? {} : { durable: options.durable }),
  };
}

/** Maps a normalized lifetime back to its numeric Nest value. */
function scopeValue(scope: NormalizedProviderScope): ProviderScope {
  if (scope === "singleton") {
    return Scope.DEFAULT;
  }
  if (scope === "request") {
    return Scope.REQUEST;
  }
  if (scope === "transient") {
    return Scope.TRANSIENT;
  }
  return scope as unknown as ProviderScope;
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
    ...scopeFields(options),
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
  useFactory: (...dependencies: TokenMap<TDependencies>) => T | Promise<T>,
  options: ProviderScopeOption = {},
): FactoryProvider<T, TDependencies> {
  return Object.freeze({
    kind: "factory",
    provide,
    inject,
    useFactory,
    ...scopeFields(options),
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
    return Object.freeze({
      kind: "class",
      provide: useClass,
      inject: classOrInject as TDependencies,
      useClass,
      ...scopeFields((injected as ProviderScopeOption | undefined) ?? {}),
    }) as ClassProvider<T, TDependencies>;
  }

  return Object.freeze({
    kind: "class",
    provide: provideOrClass,
    inject: injected,
    useClass: classOrInject as Constructor<T, TokenMap<TDependencies>>,
    ...scopeFields(options ?? {}),
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
    ...scopeFields(options),
  });
}
