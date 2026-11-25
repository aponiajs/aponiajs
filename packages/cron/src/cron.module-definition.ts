import { ConfigurableModuleBuilder } from "@aponiajs/common";
import type { ConfigurableModuleAsyncOptions, InjectionToken } from "@aponiajs/common";
import type { CronModuleOptions } from "./interfaces/cron-module.interface.ts";

const defaultKey = "cron";

/**
 * Options that shape the module definition rather than the injected scheduler
 * options.
 */
export interface CronModuleExtras {
  /**
   * The module's stable identity, so one application may run more than one
   * scheduler. Defaults to `"cron"`.
   */
  readonly key?: string;
  /** Makes the registration's exports visible without an import. Defaults to false. */
  readonly isGlobal?: boolean;
}

const builder = new ConfigurableModuleBuilder<CronModuleOptions>({
  optionsInjectionToken: "SCHEDULE_MODULE_OPTIONS",
})
  .setExtras<CronModuleExtras>({ key: defaultKey, isGlobal: true }, (definition, extras) => ({
    ...definition,
    id: `CronModule[${extras.key ?? defaultKey}]`,
    instanceId: Symbol.for(`aponia.cron:${extras.key ?? defaultKey}`),
    global: extras.isGlobal ?? false,
  }))
  .build();

/**
 * The generated registration class, options token, and type markers.
 *
 * `MODULE_OPTIONS_TOKEN` reports the registration the application declared;
 * `OPTIONS_TYPE` and `ASYNC_OPTIONS_TYPE` are type markers that throw when read
 * as values.
 *
 * This package's registration is shaped by its validated configuration: the
 * module provides the configuration token it schedules, which a container
 * factory cannot name before it runs. `forRoot` is therefore the only
 * registration, and the generated `registerAsync` is refused.
 */
export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = builder;

/** The options token, narrowed to the explicit token the builder mints. */
export const MODULE_OPTIONS_TOKEN: InjectionToken<CronModuleOptions> =
  builder.MODULE_OPTIONS_TOKEN as InjectionToken<CronModuleOptions>;

/** The synchronous registration's parameter type. */
export type CronModuleSyncOptions = CronModuleOptions & CronModuleExtras;

/** The asynchronous registration's parameter type; refused by this package. */
export type CronModuleRegistrationAsyncOptions = ConfigurableModuleAsyncOptions<CronModuleOptions> &
  Partial<CronModuleExtras>;
