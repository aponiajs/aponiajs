import type {
  ClassToken,
  Constructor,
  DynamicModule,
  ModuleImport,
  Provider,
  Token,
  TokenMap,
} from "@aponiajs/common";
import type { ElysiaPlugin } from "./plugin.types.ts";

/**
 * Options for registering an asynchronous plugin module.
 */
export interface AsyncPluginOptions<
  TOptions,
  TDependencies extends readonly Token<unknown>[] = readonly Token<unknown>[],
> {
  /** Optional modules to import for dependency resolution. */
  readonly imports?: readonly ModuleImport[];
  /** Injected tokens passed to the factory. */
  readonly inject?: TDependencies;
  /** Factory creating the options object. */
  readonly useFactory: (...dependencies: TokenMap<TDependencies>) => TOptions;
  /** Optional custom module key. */
  readonly key?: string;
}

/**
 * Module shape returned by `createServicePlugin`.
 */
export interface ServicePluginModule<TService, TOptions> {
  /** The primary token representing the injected service. */
  readonly serviceToken: Token<TService> | ClassToken<TService>;
  /** Registers the plugin with static options. */
  forRoot(options: TOptions, key?: string): DynamicModule;
  /** Registers the plugin with asynchronous/injected options. */
  forRootAsync<const TDependencies extends readonly Token<unknown>[]>(
    asyncOptions: AsyncPluginOptions<TOptions, TDependencies>,
  ): DynamicModule;
}

/**
 * Definition for creating a service/client provider plugin.
 */
export interface ServicePluginDefinition<TService, TOptions> {
  /** Unique name of the plugin (used for module ID and token names). */
  readonly name: string;
  /** The service class or token identifier. */
  readonly service: Token<TService> | ClassToken<TService>;
  /** Factory building the service instance from options. */
  readonly factory: (options: TOptions) => TService;
  /** Additional providers contributed by this plugin. */
  readonly providers?: (options: TOptions) => readonly Provider[];
  /** Optional additional tokens to export. */
  readonly exports?: readonly (Token<unknown> | ClassToken<unknown>)[];
}

/**
 * Module shape returned by `createEnhancerPlugin`.
 */
export interface EnhancerPluginModule<TOptions> {
  /** Registers the enhancer plugin with static options. */
  forRoot(options?: TOptions, key?: string): DynamicModule;
  /** Registers the enhancer plugin with asynchronous/injected options. */
  forRootAsync<const TDependencies extends readonly Token<unknown>[]>(
    asyncOptions: AsyncPluginOptions<TOptions, TDependencies>,
  ): DynamicModule;
}

/**
 * Definition for creating an enhancer/guard/filter plugin.
 */
export interface EnhancerPluginDefinition<TOptions> {
  /** Unique name of the plugin. */
  readonly name: string;
  /** Guard classes declared by this plugin. */
  readonly guards?: readonly (ClassToken<unknown> & Constructor<unknown, readonly []>)[];
  /** Interceptor classes declared by this plugin. */
  readonly interceptors?: readonly (ClassToken<unknown> & Constructor<unknown, readonly []>)[];
  /** Exception filter classes declared by this plugin. */
  readonly filters?: readonly (ClassToken<unknown> & Constructor<unknown, readonly []>)[];
  /** Additional providers contributed by this plugin. */
  readonly providers?: (options: TOptions) => readonly Provider[];
}

/**
 * Module shape returned by `wrapElysiaPlugin`.
 */
export interface ElysiaBridgePluginModule<TOptions> {
  /** Registers the wrapped native Elysia plugin with options. */
  forRoot(options?: TOptions, key?: string): DynamicModule;
  /** Registers the wrapped native Elysia plugin with asynchronous options. */
  forRootAsync<const TDependencies extends readonly Token<unknown>[]>(
    asyncOptions: AsyncPluginOptions<TOptions, TDependencies>,
  ): DynamicModule;
}

/**
 * Definition for wrapping an official or community Elysia plugin.
 */
export interface ElysiaBridgePluginDefinition<TOptions> {
  /** Unique name of the plugin. */
  readonly name: string;
  /** Factory or Elysia plugin creator function. */
  readonly plugin: (options: TOptions) => ElysiaPlugin;
}
