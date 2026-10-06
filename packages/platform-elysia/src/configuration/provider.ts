import {
  type ConfigurationOptions,
  type ConfigurationToken,
  provideFactory,
  type Token,
  type TokenMap,
} from "@aponiajs/common";
import type { FactoryProvider } from "@aponiajs/common";
import { loadConfiguration } from "./configuration-loader.ts";

/**
 * Options for declaring an asynchronous configuration provider.
 */
export interface AsyncConfigurationOptions<
  TDependencies extends readonly Token<unknown>[] = readonly [],
> {
  /** The tokens resolved and passed to `useFactory`, in order. */
  readonly inject?: TDependencies;
  /** Factory producing the configuration options or source dictionary asynchronously. */
  readonly useFactory: (
    ...dependencies: TokenMap<TDependencies>
  ) => ConfigurationOptions | Promise<ConfigurationOptions>;
}

/**
 * Turns a declaration into an ordinary singleton provider.
 *
 * Nothing here is special to configuration: because it is a factory provider it
 * is instantiated once per module in the boot's first pass, it is visible only
 * where the graph says it is, and a module that declares it twice in one module
 * fails like any other duplicate.
 *
 * @param configuration - The declaration whose schema validates the value.
 * @param options - The literal record to validate instead of `process.env`.
 * @returns A frozen factory provider the module's `providers` accepts.
 *
 * @example
 * ```ts
 * providers: [provideConfiguration(CorsConfig, { source: {} })],
 * ```
 */
export function provideConfiguration<T>(
  configuration: ConfigurationToken<T>,
  options?: ConfigurationOptions,
): FactoryProvider<T, readonly []> {
  return provideFactory(configuration, [], () => loadConfiguration(configuration, options));
}

/**
 * Declares a configuration provider resolved from an async factory.
 *
 * @param configuration - The declaration whose schema validates the value.
 * @param options - Injected dependencies and factory returning configuration options.
 * @returns A frozen factory provider the module's `providers` accepts.
 */
export function provideConfigurationAsync<const TDependencies extends readonly Token<unknown>[], T>(
  configuration: ConfigurationToken<T>,
  options: AsyncConfigurationOptions<TDependencies>,
): FactoryProvider<Promise<T>, TDependencies> {
  const dependencies = (options.inject ?? []) as unknown as TDependencies;
  return provideFactory(
    configuration as unknown as Token<Promise<T>>,
    dependencies,
    async (...args: TokenMap<TDependencies>) => {
      const resolvedOptions = await options.useFactory(...args);
      return loadConfiguration(configuration, resolvedOptions);
    },
  );
}
