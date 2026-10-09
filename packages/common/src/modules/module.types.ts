import type { ControllerDefinition } from "../controllers/controller.types.ts";
import type { MiddlewareConsumer } from "../middleware/middleware.types.ts";
import type { Provider } from "../providers/provider.types.ts";
import type { ClassToken, Token } from "../tokens/token.types.ts";
import type { ForwardReference } from "./forward-ref.types.ts";

/** An imported module descriptor or forward reference to one. */
export type ModuleImportDescriptor = ModuleDefinition | ForwardReference<ModuleDefinition>;

/**
 * A lowered module: the frozen descriptor the graph compiles, never the
 * decorated class. Modules are identified by `instanceId ?? id`.
 */
export interface ModuleDefinition {
  /** The module's identity within the graph. */
  readonly id: string;
  /** The configured-instance identity, keeping two instances of one class distinct. */
  readonly instanceId?: symbol;
  /** Whether exported providers are visible globally across the graph. */
  readonly global?: boolean;
  /** The constructor token of the decorated module class, if lowered from one. */
  readonly moduleClass?: ClassToken<unknown>;
  /** Optional middleware configuration hook. */
  readonly configure?: (consumer: MiddlewareConsumer) => void;
  /** The already-lowered modules this module resolves against. */
  readonly imports: readonly ModuleImportDescriptor[];
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
  readonly global?: boolean;
  readonly moduleClass?: ClassToken<unknown>;
  readonly configure?: (consumer: MiddlewareConsumer) => void;
  readonly imports?: readonly ModuleImportDescriptor[];
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
