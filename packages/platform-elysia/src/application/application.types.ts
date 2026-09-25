import type { ClassToken, LoggerService, LogLevel } from "@aponiajs/common";
import type { AnyElysia, Elysia, ElysiaConfig } from "elysia";
import type { AponiaControllerInvokerFactory } from "../routing/route-compiler.types.ts";

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
   * Build-time generated route invokers, keyed by controller class token. Each
   * factory receives the container's controller instance and returns the
   * invokers for that controller, keyed by handler property key.
   *
   * A controller without an entry, and a handler without a property key in its
   * controller's map, are compiled from decorator metadata exactly as they are
   * when this option is omitted. Keys survive minification because they are
   * class tokens rather than names.
   */
  readonly invokers?: ReadonlyMap<ClassToken<unknown>, AponiaControllerInvokerFactory>;
}

export interface ConfiguredAponiaApplicationOptions<
  TNativeApplication extends AnyElysia,
> extends AponiaApplicationOptions {
  readonly configureNative: NativeElysiaConfigurator<TNativeApplication>;
}
