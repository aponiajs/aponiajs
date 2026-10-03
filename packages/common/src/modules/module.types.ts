import type { ControllerDefinition } from "../controllers/controller.types.ts";
import type { Provider } from "../providers/provider.types.ts";
import type { Token } from "../tokens/token.types.ts";

/**
 * A lowered module: the frozen descriptor the graph compiles, never the
 * decorated class. Modules are identified by `instanceId ?? id`.
 */
export interface ModuleDefinition {
  /** The module's identity within the graph. */
  readonly id: string;
  /** The configured-instance identity, keeping two instances of one class distinct. */
  readonly instanceId?: symbol;
  /** The already-lowered modules this module resolves against. */
  readonly imports: readonly ModuleDefinition[];
  /** The controllers this module mounts. */
  readonly controllers: readonly ControllerDefinition[];
  /** The providers this module declares. */
  readonly providers: readonly Provider[];
  /** The tokens importers may resolve; anything else stays invisible. */
  readonly exports: readonly Token<unknown>[];
}

/** The hand-written shape `defineModule` normalizes into a descriptor. */
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
export type ModuleDescriptor<TOptions extends ModuleOptions> = Omit<
  TOptions,
  keyof ModuleDefinition
> &
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
