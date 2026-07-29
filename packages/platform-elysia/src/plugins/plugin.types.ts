import type { DynamicModule, ModuleImport, Provider, Token, TokenValues } from "@aponiajs/common";
import type { AnyElysia, Elysia } from "elysia";

export type NativeElysiaPlugin = Parameters<Elysia["use"]>[0];

export interface ElysiaPluginModuleOptions {
  readonly key?: string;
}

export interface AsyncElysiaPluginModuleOptions<
  TDependencies extends readonly Token<unknown>[],
  TPlugin extends NativeElysiaPlugin,
> extends ElysiaPluginModuleOptions {
  readonly imports?: readonly ModuleImport[];
  readonly inject: TDependencies;
  readonly useFactory: (...dependencies: TokenValues<TDependencies>) => TPlugin;
}

/**
 * A module import that carries the native plugin it installs, so the plugin is
 * both mountable and usable as a context type without a separate reference.
 */
export interface ElysiaPluginImport<TPlugin extends AnyElysia> extends DynamicModule {
  readonly imports: readonly [];
  readonly controllers: readonly [];
  readonly providers: readonly Provider[];
  readonly exports: readonly [];
  readonly plugin: TPlugin;
}
