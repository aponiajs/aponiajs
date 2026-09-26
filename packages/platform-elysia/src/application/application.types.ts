import type { LoggerService, LogLevel } from "@aponiajs/common";
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
}

export interface ConfiguredAponiaApplicationOptions<
  TNativeApplication extends AnyElysia,
> extends AponiaApplicationOptions {
  readonly configureNative: NativeElysiaConfigurator<TNativeApplication>;
}
