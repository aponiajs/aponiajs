import {
  provideAlias,
  provideClass,
  provideFactory,
  provideValue,
  type Constructor,
  type ModuleImport,
  type Provider,
  type Token,
  type TokenMap,
} from "@aponiajs/common";
import { AponiaFactory, compileRootModule } from "@aponiajs/platform-elysia";
import { applyProviderOverrides } from "../overrides/provider-overrides.ts";
import { TestApplication } from "./test-application.ts";
import type { TestApplicationOptions } from "./test-application.types.ts";
import type {
  TestApplicationBuilder,
  TestProviderOverride,
} from "./test-application-builder.types.ts";

/**
 * Builds an application for one test.
 *
 * The root module is whatever the factory accepts — a decorated class, a dynamic
 * module, or a descriptor — so a case can test the same graph the application
 * boots, or a graph it declared itself. Nothing is compiled until `compile()` is
 * called, which is where an override naming a token no module provides is
 * refused.
 *
 * @param rootModule - The root the test boots.
 * @param options - The factory's own options, with `logger` defaulting to `false`.
 * @returns A builder accepting `overrideProvider` calls before `compile()`.
 *
 * @example
 * ```ts
 * const application = await createTestApplication(AppModule)
 *   .overrideProvider(GREETING)
 *   .useValue("Hello from the test")
 *   .compile();
 * ```
 */
export function createTestApplication(
  rootModule: ModuleImport,
  options: TestApplicationOptions = {},
): TestApplicationBuilder {
  return new TestApplicationBuilderImpl(rootModule, options);
}

class TestApplicationBuilderImpl implements TestApplicationBuilder {
  readonly #rootModule: ModuleImport;
  readonly #options: TestApplicationOptions;
  readonly #overrides = new Map<Token<unknown>, Provider>();

  constructor(rootModule: ModuleImport, options: TestApplicationOptions) {
    this.#rootModule = rootModule;
    this.#options = options;
  }

  overrideProvider<T>(token: Token<T>): TestProviderOverride<T> {
    // Arrow functions rather than methods, so every one of them registers on the
    // builder that handed it out however a case detaches it from the chain.
    const useValue = (value: T): TestApplicationBuilder =>
      this.#register(provideValue(token, value));

    const useFactory = <const TDependencies extends readonly Token<unknown>[] = readonly []>(
      factory: (...dependencies: TokenMap<TDependencies>) => T,
      inject?: TDependencies,
    ): TestApplicationBuilder => {
      // An omitted `inject` states a factory that resolves nothing, and the
      // empty tuple is that statement; the cast is the one place this package
      // narrows a generic to the default it already declares.
      const dependencies = inject ?? ([] as unknown as TDependencies);
      return this.#register(provideFactory(token, dependencies, factory));
    };

    const useClass = <const TDependencies extends readonly Token<unknown>[] = readonly []>(
      substitute: Constructor<T, TokenMap<TDependencies>>,
      inject?: TDependencies,
    ): TestApplicationBuilder => {
      const dependencies = inject ?? ([] as unknown as TDependencies);
      return this.#register(provideClass(token, substitute, dependencies));
    };

    const useExisting = (existing: Token<T>): TestApplicationBuilder =>
      this.#register(provideAlias(token, existing));

    return Object.freeze({ useValue, useFactory, useClass, useExisting });
  }

  async compile(): Promise<TestApplication> {
    const { logger = false, ...rest } = this.#options;
    const options: TestApplicationOptions = { ...rest, logger };

    // With nothing overridden there is no graph to rewrite, so the root travels
    // to the factory exactly as it was handed over: the boot is the one
    // `AponiaFactory.create` performs, down to which graph the diagnostics report.
    if (this.#overrides.size === 0) {
      return new TestApplication(await AponiaFactory.create(this.#rootModule, options));
    }

    const compiled = compileRootModule(this.#rootModule);
    const overridden = applyProviderOverrides(compiled, this.#overrides);
    return new TestApplication(await AponiaFactory.create(overridden, options));
  }

  #register(provider: Provider): TestApplicationBuilder {
    this.#overrides.set(provider.provide, provider);
    return this;
  }
}
