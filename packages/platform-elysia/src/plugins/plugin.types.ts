import type { DynamicModule, ModuleImport, Provider, Token, TokenMap } from "@aponiajs/common";
import type { AnyElysia, Elysia } from "elysia";

/** Anything `Elysia.use()` accepts. */
export type ElysiaPlugin = Parameters<Elysia["use"]>[0];

/** The module identity a plugin registration mounts under. */
export interface PluginModuleOptions {
  /** The key the graph keys the registration by; defaults to a fresh symbol. */
  readonly key?: string;
}

/**
 * The `registerAsync` declaration: the imports and tokens the factory resolves,
 * and the factory building the plugin once per boot.
 */
export interface AsyncPluginModuleOptions<
  TDependencies extends readonly Token<unknown>[],
  TPlugin extends ElysiaPlugin,
> extends PluginModuleOptions {
  /** The modules whose exports the factory may inject. */
  readonly imports?: readonly ModuleImport[];
  /** The tokens resolved and passed to `useFactory`, in order. */
  readonly inject: TDependencies;
  /** Builds the plugin from the resolved dependencies. */
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
