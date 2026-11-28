import type { ControllerDefinition } from "./controller.interface.ts";
import type { ModuleImport } from "./decorators.interface.ts";
import type { MiddlewareConsumer } from "./middleware.interface.ts";
import type { NestProvider, Provider } from "./provider.interface.ts";
import type { ClassToken, InjectionDependency, Token } from "./token.interface.ts";
import type { ForwardReference } from "./forward-ref.interface.ts";

/**
 * The method an options-factory class implements for `useClass` and
 * `useExisting`.
 *
 * Mirrors Nest's `ConfigurableModuleOptionsFactory`: the container constructs
 * the class and then asks it, through this method, for the options. The method
 * may answer a Promise.
 */
export type ModuleOptionsFactory<TOptions, FactoryClassMethodKey extends string = "create"> = {
  [K in FactoryClassMethodKey]: () => TOptions | Promise<TOptions>;
};

/** What every asynchronous registration states, whatever arm it takes. */
interface ModuleAsyncOptionsBase {
  /** Modules whose exported providers the options resolve against. */
  readonly imports?: readonly ModuleImport[];
  /** Providers registered beside the options provider. */
  readonly extraProviders?: readonly Provider[];
}

/**
 * The asynchronous registration every configurable module accepts.
 *
 * Mirrors Nest's `ConfigurableModuleAsyncOptions` as a union of the three
 * supported shapes:
 *
 * - `useFactory` with optional `inject` tokens;
 * - `useClass`, a class the container constructs and then asks through its
 *   factory method for the options;
 * - `useExisting`, an existing provider that already implements that method.
 *
 * A factory may return the options or a Promise for them. `TOptions` stays the
 * module's own options type, so a plugin exporting
 * `forRootAsync(options: ModuleAsyncOptions<MyOptions>)` gets autocomplete for
 * every field its `forRoot` accepts.
 *
 * @see ConfigurableModuleBuilder for the generated-module half of the same contract.
 * @see moduleOptionsProviders for the provider builder every registration uses.
 */
export type ModuleAsyncOptions<TOptions, FactoryClassMethodKey extends string = "create"> =
  | (ModuleAsyncOptionsBase & {
      /** Builds the options once, when the module's options token first resolves. */
      readonly useFactory: (...dependencies: never[]) => TOptions | Promise<TOptions>;
      /** The tokens resolved and passed to `useFactory`, in order. */
      readonly inject?: readonly InjectionDependency[];
    })
  | (ModuleAsyncOptionsBase & {
      /** A class the container constructs and then asks for the options. */
      readonly useClass: ClassToken<ModuleOptionsFactory<TOptions, FactoryClassMethodKey>>;
    })
  | (ModuleAsyncOptionsBase & {
      /** An existing provider that answers the options through its factory method. */
      readonly useExisting: ClassToken<ModuleOptionsFactory<TOptions, FactoryClassMethodKey>>;
    });

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
  /**
   * The platform-minted per-class identity.
   *
   * The graph keys a decorated class by this when no explicit `instanceId` is
   * present; inspection does not project it, because it is not a configured
   * registration identity.
   */
  readonly moduleIdentity?: symbol;
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
  readonly providers?: readonly (Provider | NestProvider)[];
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
      readonly providers: readonly (Provider | NestProvider)[];
    }
      ? readonly Provider[]
      : readonly [];
    exports: TOptions extends {
      readonly exports: infer TExports extends readonly Token<unknown>[];
    }
      ? TExports
      : readonly [];
  }> &
  DefinedModuleInstanceId<TOptions>;
