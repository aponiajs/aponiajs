import {
  Module,
  provideFactory,
  provideValue,
  type DynamicModule,
  type Provider,
} from "@aponiajs/common";
import { CONFIG_MODULE_OPTIONS, CONFIGURATION_TOKEN, getConfigToken } from "./config.constants.ts";
import { ConfigService } from "./config.service.ts";
import { loadEnvironmentConfig } from "./utils/env-loader.ts";
import { NAMESPACE_KEY_METADATA } from "./utils/register-as.ts";
import type {
  ConfigFactory,
  ConfigModuleAsyncOptions,
  ConfigModuleOptions,
  ConfigObject,
} from "./interfaces/config-module.interface.ts";

/**
 * Nest-compatible `ConfigModule` supporting `forRoot`, `forRootAsync`, and `forFeature`.
 */
@Module({})
export class ConfigModule {
  /**
   * Registers the root configuration module synchronously (returns a `DynamicModule`
   * whose async factory loads `.env`, merges `load` factories, and validates schemas).
   *
   * @param options - Configuration loading and validation options.
   * @returns A frozen `DynamicModule` descriptor.
   */
  static forRoot(options: ConfigModuleOptions = {}): DynamicModule {
    const loadFactories = options.load ?? [];
    const featureProviders = createFeatureProviders(loadFactories);
    const featureTokens = featureProviders.map((provider) => provider.provide);

    return Object.freeze({
      id: "ConfigModule",
      instanceId: Symbol("ConfigModule.forRoot"),
      module: ConfigModule,
      global: options.isGlobal ?? false,
      providers: Object.freeze([
        provideValue(CONFIG_MODULE_OPTIONS, options),
        provideFactory(CONFIGURATION_TOKEN, [], () => buildMergedConfig(options)),
        provideFactory(
          ConfigService,
          [CONFIGURATION_TOKEN],
          (internalConfig) =>
            new ConfigService(internalConfig as ConfigObject, options.cache === true),
        ),
        ...featureProviders,
      ]),
      exports: Object.freeze([ConfigService, CONFIGURATION_TOKEN, ...featureTokens]),
    });
  }

  /**
   * Registers the root configuration module asynchronously.
   *
   * @param options - Async factory options returning `ConfigModuleOptions`.
   * @returns A frozen `DynamicModule` descriptor.
   */
  static forRootAsync(options: ConfigModuleAsyncOptions): DynamicModule {
    return Object.freeze({
      id: "ConfigModule",
      instanceId: Symbol("ConfigModule.forRootAsync"),
      module: ConfigModule,
      global: options.isGlobal ?? false,
      imports: options.imports ?? [],
      providers: Object.freeze([
        provideFactory(CONFIG_MODULE_OPTIONS, options.inject ?? [], (...args) =>
          options.useFactory(...(args as unknown as readonly never[])),
        ),
        provideFactory(CONFIGURATION_TOKEN, [CONFIG_MODULE_OPTIONS], (resolvedOptions) =>
          buildMergedConfig(resolvedOptions as ConfigModuleOptions),
        ),
        provideFactory(
          ConfigService,
          [CONFIGURATION_TOKEN, CONFIG_MODULE_OPTIONS],
          (internalConfig, resolvedOptions) =>
            new ConfigService(
              internalConfig as ConfigObject,
              (resolvedOptions as ConfigModuleOptions).cache === true,
            ),
        ),
      ]),
      exports: Object.freeze([ConfigService, CONFIGURATION_TOKEN]),
    });
  }

  /**
   * Registers a partial configuration factory (typically created via `registerAs`)
   * in a feature module.
   *
   * @param factory - Configuration factory or `registerAs` namespace factory.
   * @returns A frozen `DynamicModule` descriptor exporting `ConfigService` and the namespace token.
   */
  static forFeature(factory: ConfigFactory): DynamicModule {
    const featureProviders = createFeatureProviders([factory]);
    const featureTokens = featureProviders.map((provider) => provider.provide);
    const namespace = (factory as unknown as Record<symbol, unknown>)[NAMESPACE_KEY_METADATA];

    return Object.freeze({
      id: "ConfigModule",
      module: ConfigModule,
      instanceId: Symbol(
        typeof namespace === "string"
          ? `ConfigModule.forFeature(${namespace})`
          : "ConfigModule.forFeature",
      ),
      providers: Object.freeze([...featureProviders]),
      exports: Object.freeze([...featureTokens]),
    });
  }
}

async function buildMergedConfig(options: ConfigModuleOptions): Promise<ConfigObject> {
  const base = await loadEnvironmentConfig(options);
  const merged: ConfigObject = { ...base };

  for (const factory of options.load ?? []) {
    const value = await factory();
    const namespace = (factory as unknown as Record<symbol, unknown>)[NAMESPACE_KEY_METADATA];
    if (typeof namespace === "string") {
      merged[namespace] = value;
    } else {
      Object.assign(merged, value);
    }
  }

  return merged;
}

function createFeatureProviders(factories: readonly ConfigFactory[]): readonly Provider[] {
  const providers: Provider[] = [];
  for (const factory of factories) {
    const namespace = (factory as unknown as Record<symbol, unknown>)[NAMESPACE_KEY_METADATA];
    if (typeof namespace === "string") {
      providers.push(provideFactory(getConfigToken(namespace), [], () => factory()));
    }
  }
  return providers;
}
