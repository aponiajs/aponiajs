import {
  AponiaError,
  Module,
  provideAlias,
  provideClass,
  provideFactory,
  provideValue,
  type Constructor,
  type ModuleClass,
  type ModuleDefinition,
  type ModuleMetadata,
  type Provider,
  type Token,
  type TokenMap,
} from "@aponiajs/common";
import { createContainer, type AponiaContainer } from "@aponiajs/core";
import {
  AponiaFactory,
  compileRootModule,
  type AponiaApplication,
  type AponiaApplicationOptions,
} from "@aponiajs/platform-elysia";
import { applyProviderOverrides } from "../overrides/provider-overrides.ts";
import type {
  OverrideFactoryOptions,
  OverrideProviderBuilder,
  TestingModule,
  TestingModuleBuilder,
} from "./testing-module.types.ts";

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

  async compile(): Promise<TestingModule> {
    const rootModule = this.#createSyntheticModule();
    const compiledRoot = compileRootModule(rootModule);
    const finalRoot =
      this.#overrides.size > 0
        ? applyProviderOverrides(compiledRoot, this.#overrides)
        : compiledRoot;

    const container = createContainer(finalRoot);
    for (const module of container.graph.modules) {
      container.initializeModule(module);
    }

    return new TestingModuleImpl(finalRoot, container);
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
  #closed = false;

  constructor(rootDefinition: ModuleDefinition, container: AponiaContainer) {
    this.#rootDefinition = rootDefinition;
    this.#container = container;
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
    try {
      return this.#container.get(token, context);
    } catch (error) {
      if (error instanceof AponiaError && error.code === "MISSING_PROVIDER") {
        for (const module of this.#container.graph.modules) {
          const provider = module.providers.find((p) => p.provide === token);
          if (provider) {
            return this.#container.resolveModuleProvider(module, token, context);
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
      logger: false,
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
        if (provider.scope === "transient" || provider.scope === "request") {
          continue;
        }
        try {
          const instance = this.#container.resolveModuleProvider(module, provider.provide);
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
