import { ConfigurableModuleBuilder } from "@aponiajs/common";
import type { ConfigurableModuleAsyncOptions, InjectionToken } from "@aponiajs/common";
import type { OpenTelemetryModuleOptions } from "./interfaces/opentelemetry.interface.ts";

/** Extras shaping the `OpenTelemetryModule` dynamic module definition. */
export interface OpenTelemetryModuleExtras {
  /** Makes `OpenTelemetryService` visible without re-importing `OpenTelemetryModule`. Defaults to `true`. */
  readonly isGlobal?: boolean;
}

const builder = new ConfigurableModuleBuilder<OpenTelemetryModuleOptions>({
  moduleName: "OpenTelemetry",
})
  .setExtras<OpenTelemetryModuleExtras>({ isGlobal: true }, (definition, extras) => ({
    ...definition,
    global: extras.isGlobal ?? true,
  }))
  .build();

export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = builder;

/** The options token for `OpenTelemetryModule`. */
export const MODULE_OPTIONS_TOKEN: InjectionToken<OpenTelemetryModuleOptions> =
  builder.MODULE_OPTIONS_TOKEN as InjectionToken<OpenTelemetryModuleOptions>;

/** Synchronous registration options. */
export type OpenTelemetryModuleSyncOptions = OpenTelemetryModuleOptions & OpenTelemetryModuleExtras;

/** Asynchronous registration options. */
export type OpenTelemetryModuleRegistrationAsyncOptions =
  ConfigurableModuleAsyncOptions<OpenTelemetryModuleOptions> & Partial<OpenTelemetryModuleExtras>;
