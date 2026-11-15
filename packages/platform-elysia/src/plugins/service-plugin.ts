import {
  Module,
  type DynamicModule,
  type Provider,
  type Token,
  createToken,
  provideFactory,
  provideValue,
} from "@aponiajs/common";
import type {
  AsyncPluginOptions,
  ServicePluginDefinition,
  ServicePluginModule,
} from "./plugin-builder.types.ts";

/**
 * Creates a standardized service/client provider plugin module.
 *
 * @param definition - Configuration and factory for the service plugin.
 * @returns A module with `forRoot` and `forRootAsync` methods.
 */
export function createServicePlugin<TService, TOptions = Record<string, unknown>>(
  definition: ServicePluginDefinition<TService, TOptions>,
): ServicePluginModule<TService, TOptions> {
  const serviceToken = definition.service;
  const optionsToken = createToken<TOptions>(`aponia.plugin.${definition.name}.options`);

  @Module({})
  class ServicePluginModuleImpl {
    static readonly serviceToken = serviceToken;

    static forRoot(options: TOptions, key?: string): DynamicModule {
      const extraProviders = definition.providers ? definition.providers(options) : [];
      const userExports = definition.exports ?? [];

      const providers: Provider[] = [
        provideValue(optionsToken, options),
        provideFactory(serviceToken, [optionsToken], (opts: TOptions) => definition.factory(opts)),
        ...extraProviders,
      ];

      const moduleKey = key ?? definition.name;
      const id = `PluginModule[${moduleKey}]`;
      const instanceId = Symbol.for(`aponia.plugin.${definition.name}:${moduleKey}`);

      return Object.freeze({
        module: ServicePluginModuleImpl,
        id,
        instanceId,
        imports: Object.freeze([]),
        providers: Object.freeze(providers),
        exports: Object.freeze([serviceToken, ...userExports]),
      });
    }

    static forRootAsync<const TDependencies extends readonly Token<unknown>[]>(
      asyncOptions: AsyncPluginOptions<TOptions, TDependencies>,
    ): DynamicModule {
      const injectTokens = (asyncOptions.inject ?? []) as TDependencies;

      const providers: Provider[] = [
        provideFactory(optionsToken, injectTokens, (...deps) => asyncOptions.useFactory(...deps)),
        provideFactory(serviceToken, [optionsToken], (opts: TOptions) => definition.factory(opts)),
      ];

      const userExports = definition.exports ?? [];
      const moduleKey = asyncOptions.key ?? definition.name;
      const id = `PluginModule[${moduleKey}]`;
      const instanceId = Symbol.for(`aponia.plugin.${definition.name}:${moduleKey}`);

      return Object.freeze({
        module: ServicePluginModuleImpl,
        id,
        instanceId,
        imports: Object.freeze([...(asyncOptions.imports ?? [])]),
        providers: Object.freeze(providers),
        exports: Object.freeze([serviceToken, ...userExports]),
      });
    }
  }

  return ServicePluginModuleImpl;
}
