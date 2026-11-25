import type { ModuleImport, Token, TokenMap } from "@aponiajs/common";

/**
 * Options for registering an asynchronous plugin module.
 *
 * The shape `wrapElysiaPlugin` accepts for its `forRootAsync` form, and the one
 * every registration that exposes an asynchronous spelling states, so a caller
 * reads one contract whichever builder wrote the module.
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
