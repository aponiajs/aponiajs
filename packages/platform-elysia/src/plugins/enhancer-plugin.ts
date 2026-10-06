import {
  Module,
  type DynamicModule,
  type Provider,
  type Token,
  createToken,
  provideClass,
  provideFactory,
  provideValue,
} from "@aponiajs/common";
import type {
  AsyncPluginOptions,
  EnhancerPluginDefinition,
  EnhancerPluginModule,
} from "./plugin-builder.types.ts";

/**
 * Creates a standardized enhancer/guard/filter plugin module.
 *
 * @param definition - Enhancers and configurations.
 * @returns A module with `forRoot` and `forRootAsync` methods.
 */
export function createEnhancerPlugin<TOptions = Record<string, unknown>>(
  definition: EnhancerPluginDefinition<TOptions>,
): EnhancerPluginModule<TOptions> {
  const optionsToken = createToken<TOptions>(`aponia.plugin.${definition.name}.options`);

  @Module({})
  class EnhancerPluginModuleImpl {
    static forRoot(options: TOptions = {} as TOptions, key?: string): DynamicModule {
      const extraProviders = definition.providers ? definition.providers(options) : [];
      const enhancerProviders: Provider[] = [
        ...(definition.guards ?? []).map((guard) => provideClass(guard, [])),
        ...(definition.interceptors ?? []).map((interceptor) => provideClass(interceptor, [])),
        ...(definition.filters ?? []).map((filter) => provideClass(filter, [])),
      ];

      const providers: Provider[] = [
        provideValue(optionsToken, options),
        ...enhancerProviders,
        ...extraProviders,
      ];

      const moduleKey = key ?? definition.name;
      const id = `PluginModule[${moduleKey}]`;
      const instanceId = Symbol.for(`aponia.plugin.${definition.name}:${moduleKey}`);

      return Object.freeze({
        module: EnhancerPluginModuleImpl,
        id,
        instanceId,
        imports: Object.freeze([]),
        providers: Object.freeze(providers),
        exports: Object.freeze([
          ...(definition.guards ?? []),
          ...(definition.interceptors ?? []),
          ...(definition.filters ?? []),
        ]),
      });
    }

    static forRootAsync<const TDependencies extends readonly Token<unknown>[]>(
      asyncOptions: AsyncPluginOptions<TOptions, TDependencies>,
    ): DynamicModule {
      const injectTokens = (asyncOptions.inject ?? []) as TDependencies;
      const enhancerProviders: Provider[] = [
        ...(definition.guards ?? []).map((guard) => provideClass(guard, [])),
        ...(definition.interceptors ?? []).map((interceptor) => provideClass(interceptor, [])),
        ...(definition.filters ?? []).map((filter) => provideClass(filter, [])),
      ];

      const providers: Provider[] = [
        provideFactory(optionsToken, injectTokens, (...deps) => asyncOptions.useFactory(...deps)),
        ...enhancerProviders,
      ];

      const moduleKey = asyncOptions.key ?? definition.name;
      const id = `PluginModule[${moduleKey}]`;
      const instanceId = Symbol.for(`aponia.plugin.${definition.name}:${moduleKey}`);

      return Object.freeze({
        module: EnhancerPluginModuleImpl,
        id,
        instanceId,
        imports: Object.freeze([...(asyncOptions.imports ?? [])]),
        providers: Object.freeze(providers),
        exports: Object.freeze([
          ...(definition.guards ?? []),
          ...(definition.interceptors ?? []),
          ...(definition.filters ?? []),
        ]),
      });
    }
  }

  return EnhancerPluginModuleImpl;
}
