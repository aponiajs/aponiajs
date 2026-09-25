import type { LoggerService, LogLevel } from "@aponiajs/common";
import type { AnyElysia, Elysia, ElysiaConfig } from "elysia";
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
}

export interface ConfiguredAponiaApplicationOptions<
  TNativeApplication extends AnyElysia,
> extends AponiaApplicationOptions {
  readonly configureNative: NativeElysiaConfigurator<TNativeApplication>;
}
