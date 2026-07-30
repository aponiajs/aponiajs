import type { ControllerDefinition } from "../controllers/controller.types.ts";
import type { Provider } from "../providers/provider.types.ts";
import type { Token } from "../tokens/token.types.ts";

export interface ModuleDefinition {
  readonly id: string;
  readonly instanceId?: symbol;
  readonly imports: readonly ModuleDefinition[];
  readonly controllers: readonly ControllerDefinition[];
  readonly providers: readonly Provider[];
  readonly exports: readonly Token<unknown>[];
}

export interface ModuleOptions {
  readonly id: string;
  readonly instanceId?: symbol;
  readonly imports?: readonly ModuleDefinition[];
  readonly controllers?: readonly ControllerDefinition[];
  readonly providers?: readonly Provider[];
  readonly exports?: readonly Token<unknown>[];
}

type DefinedModuleInstanceId<TOptions extends ModuleOptions> = "instanceId" extends keyof TOptions
  ? { readonly instanceId: TOptions["instanceId"] }
  : { readonly instanceId?: undefined };

/**
 * A normalized module descriptor that retains literal collection types while
 * reflecting the empty frozen arrays supplied for omitted options.
 */
export type DefinedModule<TOptions extends ModuleOptions> = Omit<TOptions, keyof ModuleDefinition> &
  Readonly<{
    id: TOptions["id"];
    imports: TOptions extends {
      readonly imports: infer TImports extends readonly ModuleDefinition[];
    }
      ? TImports
      : readonly [];
    controllers: TOptions extends {
      readonly controllers: infer TControllers extends readonly ControllerDefinition[];
    }
      ? TControllers
      : readonly [];
    providers: TOptions extends {
      readonly providers: infer TProviders extends readonly Provider[];
    }
      ? TProviders
      : readonly [];
    exports: TOptions extends {
      readonly exports: infer TExports extends readonly Token<unknown>[];
    }
      ? TExports
      : readonly [];
  }> &
  DefinedModuleInstanceId<TOptions>;
