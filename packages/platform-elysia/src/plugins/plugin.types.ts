import type { DynamicModule, ModuleImport, Provider, Token, TokenMap } from "@aponiajs/common";
import type { AnyElysia, Elysia } from "elysia";

export type ElysiaPlugin = Parameters<Elysia["use"]>[0];

export interface PluginModuleOptions {
  readonly key?: string;
}

export interface AsyncPluginModuleOptions<
  TDependencies extends readonly Token<unknown>[],
  TPlugin extends ElysiaPlugin,
> extends PluginModuleOptions {
  readonly imports?: readonly ModuleImport[];
  readonly inject: TDependencies;
  readonly useFactory: (...dependencies: TokenMap<TDependencies>) => TPlugin;
}

/**
 * A module import that carries the native plugin it installs, so the plugin is
 * both mountable and usable as a context type without a separate reference.
 */
export interface PluginImport<TPlugin extends AnyElysia> extends DynamicModule {
  readonly imports: readonly [];
  readonly controllers: readonly [];
  readonly providers: readonly Provider[];
  readonly exports: readonly [];
  readonly plugin: TPlugin;
}
