import type {
  Constructor,
  LoggerService,
  ModuleClass,
  ModuleDefinition,
  ModuleMetadata,
  Token,
  TokenMap,
} from "@aponiajs/common";
import type { AponiaApplication, AponiaApplicationOptions } from "@aponiajs/platform-elysia";

/**
 * Options for configuring a factory provider override.
 */
export interface OverrideFactoryOptions<
  T,
  TDependencies extends readonly Token<unknown>[] = readonly [],
> {
  /** The factory function producing the replacement instance. */
  readonly factory: (...dependencies: TokenMap<TDependencies>) => T;
  /** Tokens of the dependencies injected into the factory function. */
  readonly inject?: TDependencies;
}

/**
 * Fluent builder for substituting an individual provider in a testing module.
 */
export interface OverrideProviderBuilder<T> {
  /**
   * Replaces the provider with a constant value.
   *
   * @param value - The substitute value.
   * @returns The testing module builder for chaining.
   */
  useValue(value: T): TestingModuleBuilder;

  /**
   * Replaces the provider with an alternate class constructor.
   *
   * @param substitute - The substitute class constructor.
   * @param inject - Optional array of dependency tokens.
   * @returns The testing module builder for chaining.
   */
  useClass<const TDependencies extends readonly Token<unknown>[] = readonly []>(
    substitute: Constructor<T, TokenMap<TDependencies>>,
    inject?: TDependencies,
  ): TestingModuleBuilder;

  /**
   * Replaces the provider with a factory function.
   *
   * @param factoryOrOptions - Factory function or options containing factory and inject tokens.
   * @param inject - Optional dependency tokens when passing a bare factory function.
   * @returns The testing module builder for chaining.
   */
  useFactory<const TDependencies extends readonly Token<unknown>[] = readonly []>(
    factoryOrOptions:
      | OverrideFactoryOptions<T, TDependencies>
      | ((...dependencies: TokenMap<TDependencies>) => T),
    inject?: TDependencies,
  ): TestingModuleBuilder;

  /**
   * Replaces the provider with an existing token alias.
   *
   * @param existing - The target token to alias.
   * @returns The testing module builder for chaining.
   */
  useExisting(existing: Token<T>): TestingModuleBuilder;
}

/**
 * Fluent builder replacing one whole module.
 *
 * Nest's `overrideModule` matches by reference; a dynamic module's factory is
 * not re-run, so the replacement is what the graph uses in place of the module
 * the test named.
 */
export interface ModuleOverrideBuilder {
  /** Replaces the module with a class, a dynamic module, or a descriptor. */
  useValue(value: ModuleClass | ModuleDefinition): TestingModuleBuilder;
  /** Replaces the module with a class the boot lowers. */
  useClass(substitute: ModuleClass): TestingModuleBuilder;
  /** Replaces the module with whatever the factory returns. */
  useFactory(factory: () => ModuleClass | ModuleDefinition): TestingModuleBuilder;
}

/**
 * Fluent builder configuring and compiling a testing module.
 */
export interface TestingModuleBuilder {
  /**
   * Overrides a provider token across the testing module graph.
   *
   * @param token - The token to override.
   * @returns Builder to configure the replacement provider.
   */
  overrideProvider<T>(token: Token<T>): OverrideProviderBuilder<T>;

  /** Overrides a guard provider; the provider rewrite under another name. */
  overrideGuard<T>(guard: Token<T>): OverrideProviderBuilder<T>;
  /** Overrides an interceptor provider. */
  overrideInterceptor<T>(interceptor: Token<T>): OverrideProviderBuilder<T>;
  /** Overrides an exception filter provider. */
  overrideFilter<T>(filter: Token<T>): OverrideProviderBuilder<T>;
  /** Overrides a pipe provider. */
  overridePipe<T>(pipe: Token<T>): OverrideProviderBuilder<T>;

  /**
   * Replaces one module in the graph.
   *
   * @param module - The module class the graph imports.
   * @returns Builder to configure the replacement.
   */
  overrideModule(module: ModuleClass): ModuleOverrideBuilder;

  /**
   * Supplies a substitute for every provider no explicit override names.
   *
   * The mocker receives each provider token and answers a value or `undefined`;
   * `undefined` leaves that provider as it is.
   *
   * @param mocker - The per-token factory.
   * @returns This builder.
   */
  useMocker(mocker: (token: Token<unknown>) => unknown): TestingModuleBuilder;

  /**
   * Sets the logger the created application uses.
   *
   * @param logger - The logger to install.
   * @returns This builder.
   */
  setLogger(logger: LoggerService): TestingModuleBuilder;

  /**
   * Compiles the module graph, applies provider overrides, and returns the testing module.
   *
   * @returns The compiled testing module fixture.
   */
  compile(): Promise<TestingModule>;
}

/**
 * A compiled testing module providing DI resolution and application bootstrapping.
 */
export interface TestingModule {
  /**
   * Resolves a provider token synchronously from the testing container.
   *
   * @param token - The provider token to retrieve.
   * @returns The resolved provider instance.
   */
  get<T>(token: Token<T>): T;

  /**
   * Resolves a provider token asynchronously, optionally within a request context.
   *
   * @param token - The provider token to retrieve.
   * @param context - Optional request context object.
   * @returns A promise resolving to the provider instance.
   */
  resolve<T>(token: Token<T>, context?: object): Promise<T>;

  /**
   * Boots a complete HTTP application from this testing module.
   *
   * @param options - Application options forwarded to AponiaFactory.
   * @returns The booted AponiaApplication.
   */
  createAponiaApplication(options?: AponiaApplicationOptions): Promise<AponiaApplication>;

  /**
   * Closes the testing module and runs all lifecycle teardown hooks.
   */
  close(): Promise<void>;
}

export type { ModuleMetadata, ModuleClass };
