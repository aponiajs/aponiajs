import {
  Module,
  type DynamicModule,
  type Token,
  createToken,
  provideFactory,
  provideValue,
} from "@aponiajs/common";
import { ELYSIA_PLUGIN } from "./plugin-module.ts";
import type {
  AsyncPluginOptions,
  ElysiaBridgePluginDefinition,
  ElysiaBridgePluginModule,
} from "./plugin-builder.types.ts";

/**
 * Wraps an official or community Elysia plugin into a first-class Aponia module.
 *
 * @param definition - Name and Elysia plugin function.
 * @returns A module with `forRoot` and `forRootAsync` methods.
 */
export function wrapElysiaPlugin<TOptions = Record<string, unknown>>(
  definition: ElysiaBridgePluginDefinition<TOptions>,
): ElysiaBridgePluginModule<TOptions> {
  const optionsToken = createToken<TOptions>(`aponia.plugin.${definition.name}.options`);

  @Module({})
  class ElysiaBridgePluginModuleImpl {
    static forRoot(options: TOptions = {} as TOptions, key?: string): DynamicModule {
      const nativePlugin = definition.plugin(options);

      const moduleKey = key ?? definition.name;
      const id = `PluginModule[${moduleKey}]`;
      const instanceId = Symbol.for(`aponia.plugin.${definition.name}:${moduleKey}`);

      return Object.freeze({
        module: ElysiaBridgePluginModuleImpl,
        id,
        instanceId,
        imports: Object.freeze([]),
        providers: Object.freeze([
          provideValue(optionsToken, options),
          provideValue(ELYSIA_PLUGIN, nativePlugin),
        ]),
        exports: Object.freeze([]),
      });
    }

    static forRootAsync<const TDependencies extends readonly Token<unknown>[]>(
      asyncOptions: AsyncPluginOptions<TOptions, TDependencies>,
    ): DynamicModule {
      const injectTokens = (asyncOptions.inject ?? []) as TDependencies;

      const moduleKey = asyncOptions.key ?? definition.name;
      const id = `PluginModule[${moduleKey}]`;
      const instanceId = Symbol.for(`aponia.plugin.${definition.name}:${moduleKey}`);

      return Object.freeze({
        module: ElysiaBridgePluginModuleImpl,
        id,
        instanceId,
        imports: Object.freeze([...(asyncOptions.imports ?? [])]),
        providers: Object.freeze([
          provideFactory(optionsToken, injectTokens, (...deps) => asyncOptions.useFactory(...deps)),
          provideFactory(ELYSIA_PLUGIN, [optionsToken], (resolvedOptions: TOptions) =>
            definition.plugin(resolvedOptions),
          ),
        ]),
        exports: Object.freeze([]),
      });
    }
  }

  return ElysiaBridgePluginModuleImpl;
}
