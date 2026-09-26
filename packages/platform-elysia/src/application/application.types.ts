import type { ClassToken, LoggerService, LogLevel } from "@aponiajs/common";
import type { AnyElysia, Elysia, ElysiaConfig } from "elysia";
import type { AponiaModuleDescriptorArtifact } from "../modules/module-descriptor-artifact.types.ts";
import type { AponiaInvokerArtifact } from "../routing/invoker-artifact.types.ts";

export type NativeElysiaConfigurator<TNativeApplication extends AnyElysia> = (
  application: Elysia,
) => TNativeApplication;

export type ElysiaCompilationOptions = Readonly<
  Pick<ElysiaConfig<undefined>, "aot" | "precompile">
>;

export interface AponiaApplicationOptions {
  readonly logger?: false | LoggerService | readonly LogLevel[];
  /**
   * Controls Elysia's route composition. This is distinct from build-time
   * Aponia source generation and JavaScriptCore's machine-code JIT.
   *
   * `aot: false` selects Elysia's generic dynamic dispatcher, which never reads
   * a route's own `error` array: every declared exception filter and the default
   * Problem Details mapping live there, so under this policy neither runs and an
   * unhandled failure answers Elysia's native `500` carrying the exception's
   * message. Bootstrap warns under `RoutesResolver` when the option is set.
   */
  readonly elysia?: ElysiaCompilationOptions;
  /**
   * A build-time generated invoker artifact, as `aponia build` writes it. Its
   * invokers are keyed by controller class token, and each factory receives the
   * container's controller instance and returns that controller's invokers
   * keyed by handler property key.
   *
   * A controller without an entry, and a handler without a property key in its
   * controller's map, are compiled from decorator metadata exactly as they are
   * when this option is omitted. Keys survive minification because they are
   * class tokens rather than names.
   *
   * An artifact built by another framework release is refused whole and the
   * application boots on compiled binding; see {@link AponiaInvokerArtifact}.
   */
  readonly invokers?: AponiaInvokerArtifact;
  /**
   * A build-time generated module descriptor artifact, as `aponia build` writes
   * it. Its record holds one declared module per module class name, and the root
   * module passed to the factory is substituted by the declaration matching its
   * name.
   *
   * An artifact this release cannot use — one built by another framework
   * release, one whose root name it does not hold, or one whose entries are not
   * module descriptors — is refused whole and the root module is lowered from
   * its decorators exactly as it is when this option is omitted. Refusing costs
   * the lowering the artifact exists to remove and nothing more, so supplying it
   * can never make a bootable application fail.
   *
   * The startup log reports which of the two graphs served the application,
   * because the answer decides what a route actually runs.
   */
  readonly descriptors?: AponiaModuleDescriptorArtifact;
  /**
   * Guards every route runs, before the ones a controller or a handler declares.
   *
   * A global guard reaches every route of every module, so it is resolved once,
   * through the root module: the class must be a provider the root module can
   * reach, and one it cannot reach fails `AponiaFactory.create` with the
   * `MISSING_PROVIDER` a missing dependency raises rather than leaving a route
   * unguarded.
   *
   * There is deliberately no `useGlobalGuards()` method: routes mount during
   * `AponiaFactory.create`, so a method called on the returned application could
   * not affect them.
   */
  readonly guards?: readonly ClassToken<unknown>[];
  /** Interceptors every route runs, declared and resolved the way `guards` are. */
  readonly interceptors?: readonly ClassToken<unknown>[];
  /** Filters every route consults, declared and resolved the way `guards` are. */
  readonly filters?: readonly ClassToken<unknown>[];
}

export interface ConfiguredAponiaApplicationOptions<
  TNativeApplication extends AnyElysia,
> extends AponiaApplicationOptions {
  readonly configureNative: NativeElysiaConfigurator<TNativeApplication>;
}
