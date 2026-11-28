import { ConfigurableModuleBuilder } from "@aponiajs/common";
import type { ConfigurableModuleAsyncOptions, InjectionToken } from "@aponiajs/common";
import type { MetricsModuleOptions } from "./interfaces/metrics.interface.ts";

/** Extras shaping the `MetricsModule` dynamic module definition. */
export interface MetricsModuleExtras {
  /** Makes `MetricsService` visible without re-importing `MetricsModule`. Defaults to `true`. */
  readonly isGlobal?: boolean;
}

const builder = new ConfigurableModuleBuilder<MetricsModuleOptions>({
  moduleName: "Metrics",
})
  .setExtras<MetricsModuleExtras>({ isGlobal: true }, (definition, extras) => ({
    ...definition,
    global: extras.isGlobal ?? true,
  }))
  .build();

export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = builder;

/** The options token for `MetricsModule`. */
export const MODULE_OPTIONS_TOKEN: InjectionToken<MetricsModuleOptions> =
  builder.MODULE_OPTIONS_TOKEN as InjectionToken<MetricsModuleOptions>;

/** Synchronous registration options. */
export type MetricsModuleSyncOptions = MetricsModuleOptions & MetricsModuleExtras;

/** Asynchronous registration options. */
export type MetricsModuleRegistrationAsyncOptions =
  ConfigurableModuleAsyncOptions<MetricsModuleOptions> & Partial<MetricsModuleExtras>;
