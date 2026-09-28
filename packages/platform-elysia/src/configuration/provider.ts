import {
  type ConfigurationOptions,
  type ConfigurationToken,
  provideFactory,
} from "@aponiajs/common";
import type { FactoryProvider } from "@aponiajs/common";
import { loadConfiguration } from "./configuration-loader.ts";

/**
 * Turns a declaration into an ordinary singleton provider.
 *
 * Nothing here is special to configuration: because it is a factory provider it
 * is instantiated once per module in the boot's first pass, it is visible only
 * where the graph says it is, and a module that declares it twice in one module
 * fails like any other duplicate.
 */
export function provideConfiguration<T>(
  configuration: ConfigurationToken<T>,
  options?: ConfigurationOptions,
): FactoryProvider<T, readonly []> {
  return provideFactory(configuration, [], () => loadConfiguration(configuration, options));
}
