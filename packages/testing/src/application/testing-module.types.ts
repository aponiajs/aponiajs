import type { Constructor, ModuleClass, ModuleMetadata, Token, TokenMap } from "@aponiajs/common";
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
