import type { DynamicModule, Token } from "@aponiajs/common";
import type { AsyncPluginOptions } from "@aponiajs/platform-core";
import type { ElysiaPlugin } from "./plugin.types.ts";

export type { AsyncPluginOptions } from "@aponiajs/platform-core";

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
