import {
  AponiaError,
  Module,
  Reflector,
  isApplicationEnhancerToken,
  isForwardRef,
  provideAlias,
  provideClass,
  provideFactory,
  provideValue,
  type Constructor,
  type LoggerService,
  type ModuleClass,
  type ModuleDefinition,
  type ModuleMetadata,
  type Provider,
  type Token,
  type TokenMap,
} from "@aponiajs/common";
import { ContextIdFactory, createContainer, type AponiaContainer } from "@aponiajs/core";
import {
  AponiaFactory,
  compileRootModuleAsync,
  type AponiaApplication,
  type AponiaApplicationOptions,
} from "@aponiajs/platform-elysia";
import { applyProviderOverrides } from "../overrides/provider-overrides.ts";
import { replaceCompiledModule } from "../overrides/module-overrides.ts";
import type {
  ModuleOverrideBuilder,
  OverrideFactoryOptions,
  OverrideProviderBuilder,
  TestingModule,
  TestingModuleBuilder,
} from "../interfaces/testing-module.interface.ts";

/**
 * Test utility providing NestJS-style test module creation and provider overrides.
 */
export class Test {
  /**
   * Creates a testing module builder from module metadata or a root module class.
   *
   * @param metadataOrModule - The module metadata or root module class to test.
   * @returns A TestingModuleBuilder to configure overrides and compile.
   *
   * @example
   * ```ts
   * const moduleRef = await Test.createTestingModule({
   *   imports: [UsersModule],
   *   providers: [UsersService],
   * })
   *   .overrideProvider(DatabaseService)
   *   .useValue(mockDb)
   *   .compile();
   *
   * const service = moduleRef.get(UsersService);
   * ```
   */
  static createTestingModule(metadataOrModule: ModuleMetadata | ModuleClass): TestingModuleBuilder {
    return new TestingModuleBuilderImpl(metadataOrModule);
  }
}

class TestingModuleBuilderImpl implements TestingModuleBuilder {
  readonly #target: ModuleMetadata | ModuleClass;
  readonly #overrides = new Map<Token<unknown>, Provider>();
  readonly #moduleOverrides = new Map<ModuleClass, () => ModuleClass | ModuleDefinition>();
  #mocker?: (token: Token<unknown>) => unknown;
  #logger?: LoggerService;

  constructor(target: ModuleMetadata | ModuleClass) {
    this.#target = target;
  }

  overrideProvider<T>(token: Token<T>): OverrideProviderBuilder<T> {
    const useValue = (value: T): TestingModuleBuilder => this.#register(provideValue(token, value));

    const useFactory = <const TDependencies extends readonly Token<unknown>[] = readonly []>(
      factoryOrOptions:
        | OverrideFactoryOptions<T, TDependencies>
        | ((...dependencies: TokenMap<TDependencies>) => T),
      inject?: TDependencies,
    ): TestingModuleBuilder => {
      if (typeof factoryOrOptions === "function") {
        const dependencies = inject ?? ([] as unknown as TDependencies);
        return this.#register(provideFactory(token, dependencies, factoryOrOptions));
      }
      const dependencies = factoryOrOptions.inject ?? ([] as unknown as TDependencies);
      return this.#register(provideFactory(token, dependencies, factoryOrOptions.factory));
    };

    const useClass = <const TDependencies extends readonly Token<unknown>[] = readonly []>(
      substitute: Constructor<T, TokenMap<TDependencies>>,
      inject?: TDependencies,
    ): TestingModuleBuilder => {
      const dependencies = inject ?? ([] as unknown as TDependencies);
      return this.#register(provideClass(token, substitute, dependencies));
    };

    const useExisting = (existing: Token<T>): TestingModuleBuilder =>
      this.#register(provideAlias(token, existing));

    return Object.freeze({ useValue, useFactory, useClass, useExisting });
  }

  #register(provider: Provider): TestingModuleBuilder {
    this.#overrides.set(provider.provide, provider);
    return this;
  }

  // The enhancer names are the provider override under the name a case looks
  // for: a guard, interceptor, filter, or pipe named by a decorator, a declared
  // plan, or the options is resolved from this container by token.
  overrideGuard<T>(guard: Token<T>): OverrideProviderBuilder<T> {
    return this.overrideProvider(guard);
  }

  overrideInterceptor<T>(interceptor: Token<T>): OverrideProviderBuilder<T> {
    return this.overrideProvider(interceptor);
  }

  overrideFilter<T>(filter: Token<T>): OverrideProviderBuilder<T> {
    return this.overrideProvider(filter);
  }

  overridePipe<T>(pipe: Token<T>): OverrideProviderBuilder<T> {
    return this.overrideProvider(pipe);
  }

  overrideModule(module: ModuleClass): ModuleOverrideBuilder {
    const useValue = (value: ModuleClass | ModuleDefinition): TestingModuleBuilder => {
      this.#moduleOverrides.set(module, () => value);
      return this;
    };
    const useClass = (substitute: ModuleClass): TestingModuleBuilder => useValue(substitute);
    const useFactory = (factory: () => ModuleClass | ModuleDefinition): TestingModuleBuilder => {
      this.#moduleOverrides.set(module, factory);
      return this;
    };
    return Object.freeze({ useValue, useClass, useFactory });
  }

  useMocker(mocker: (token: Token<unknown>) => unknown): TestingModuleBuilder {
    this.#mocker = mocker;
    return this;
  }

  setLogger(logger: LoggerService): TestingModuleBuilder {
    this.#logger = logger;
    return this;
  }

  async compile(): Promise<TestingModule> {
    const rootModule = this.#createSyntheticModule();
    let compiledRoot = await compileRootModuleAsync(rootModule);

    for (const [target, replacement] of this.#moduleOverrides) {
      const resolved = replacement();
      const definition =
        typeof resolved === "function" ? await compileRootModuleAsync(resolved) : resolved;
      compiledRoot = replaceCompiledModule(compiledRoot, target, definition);
    }

    const overrides = new Map(this.#overrides);
    if (this.#mocker !== undefined) {
      collectProviderTokens(compiledRoot, overrides, this.#mocker, new Set());
    }

    const finalRoot =
      overrides.size > 0 ? applyProviderOverrides(compiledRoot, overrides) : compiledRoot;

    const container = createContainer(finalRoot, [provideClass(Reflector, [])]);
    for (const module of container.graph.modules) {
      await container.initializeModuleAsync(module);
    }

    return new TestingModuleImpl(finalRoot, container, this.#logger);
  }

  #createSyntheticModule(): ModuleClass | ModuleDefinition {
    if (typeof this.#target === "function") {
      return this.#target;
    }
    @Module(this.#target)
    class SyntheticTestingModule {}
    return SyntheticTestingModule;
  }
}

class TestingModuleImpl implements TestingModule {
  readonly #rootDefinition: ModuleDefinition;
  readonly #container: AponiaContainer;
  readonly #logger: LoggerService | undefined;
  #closed = false;

  constructor(
    rootDefinition: ModuleDefinition,
    container: AponiaContainer,
    logger?: LoggerService,
  ) {
    this.#rootDefinition = rootDefinition;
    this.#container = container;
    this.#logger = logger;
  }

  get<T>(token: Token<T>): T {
    try {
      return this.#container.get(token);
    } catch (error) {
      if (error instanceof AponiaError && error.code === "MISSING_PROVIDER") {
        for (const module of this.#container.graph.modules) {
          const provider = module.providers.find((p) => p.provide === token);
          if (provider) {
            return this.#container.resolveModuleProvider(module, token);
          }
        }
      }
      throw error;
    }
  }

  async resolve<T>(token: Token<T>, context?: object): Promise<T> {
    const contextId = context ?? ContextIdFactory.create();
    try {
      return this.#container.get(token, contextId);
    } catch (error) {
      if (error instanceof AponiaError && error.code === "MISSING_PROVIDER") {
        for (const module of this.#container.graph.modules) {
          const provider = module.providers.find((p) => p.provide === token);
          if (provider) {
            return this.#container.resolveModuleProvider(module, token, contextId);
          }
        }
      }
      throw error;
    }
  }

  async createAponiaApplication(
    options: AponiaApplicationOptions = {},
  ): Promise<AponiaApplication> {
    return AponiaFactory.create(this.#rootDefinition, {
      logger: this.#logger ?? false,
      ...options,
    });
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    for (const module of this.#container.graph.modules) {
      for (const provider of module.providers) {
        if (isApplicationEnhancerToken(provider.provide)) {
          continue;
        }
        if (this.#container.providerScope(module, provider) !== "singleton") {
          continue;
        }
        try {
          const instance = this.#container.resolveProvider(module, provider);
          if (
            typeof instance === "object" &&
            instance !== null &&
            "onModuleDestroy" in instance &&
            typeof (instance as { onModuleDestroy: unknown }).onModuleDestroy === "function"
          ) {
            await (instance as { onModuleDestroy: () => unknown }).onModuleDestroy();
          }
        } catch {
          // teardown is safe
        }
      }
    }
  }
}

/**
 * Adds one mocker value per provider token the graph declares.
 *
 * A token already overridden, and the four `APP_*` pseudo-providers, are
 * skipped: a mocker is a substitute for a provider's own value, and an
 * application-enhancer token has no single value to substitute.
 */
function collectProviderTokens(
  module: ModuleDefinition,
  overrides: Map<Token<unknown>, Provider>,
  mocker: (token: Token<unknown>) => unknown,
  visited: Set<ModuleDefinition>,
): void {
  if (visited.has(module)) {
    return;
  }
  visited.add(module);

  for (const provider of module.providers) {
    if (isApplicationEnhancerToken(provider.provide) || overrides.has(provider.provide)) {
      continue;
    }
    const value = mocker(provider.provide);
    if (value !== undefined) {
      overrides.set(provider.provide, provideValue(provider.provide, value));
    }
  }

  for (const imported of module.imports) {
    if (isForwardRef(imported)) {
      continue;
    }
    collectProviderTokens(imported, overrides, mocker, visited);
  }
}
