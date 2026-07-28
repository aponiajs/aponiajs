import type { LoggerService, LogLevel } from "@aponiajs/common";
import type { AnyElysia, Elysia, ElysiaConfig } from "elysia";

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
}

export interface ConfiguredAponiaApplicationOptions<
  TNativeApplication extends AnyElysia,
> extends AponiaApplicationOptions {
  readonly configureNative: NativeElysiaConfigurator<TNativeApplication>;
}
