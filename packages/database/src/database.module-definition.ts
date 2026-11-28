import { ConfigurableModuleBuilder } from "@aponiajs/common";
import type { ConfigurableModuleAsyncOptions, InjectionToken } from "@aponiajs/common";
import type { DatabaseModuleOptions } from "./interfaces/database-module.interface.ts";

/**
 * Options that shape the module definition rather than the injected database
 * options, mirroring the `isGlobal` extra every Nest configurable module states.
 */
export interface DatabaseModuleExtras {
  /** Makes the registration's exports visible without an import. Defaults to false. */
  readonly isGlobal?: boolean;
}

const builder = new ConfigurableModuleBuilder<DatabaseModuleOptions>({
  moduleName: "Database",
})
  .setExtras<DatabaseModuleExtras>({ isGlobal: false }, (definition, extras) => ({
    ...definition,
    global: extras.isGlobal ?? false,
  }))
  .build();

/**
 * The generated registration class, options token, and type markers.
 *
 * `MODULE_OPTIONS_TOKEN` is the `DATABASE_MODULE_OPTIONS` token; `OPTIONS_TYPE`
 * and `ASYNC_OPTIONS_TYPE` are type markers that throw when read as values.
 */
export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = builder;

/** The options token, narrowed to the explicit token the builder mints. */
export const MODULE_OPTIONS_TOKEN: InjectionToken<DatabaseModuleOptions> =
  builder.MODULE_OPTIONS_TOKEN as InjectionToken<DatabaseModuleOptions>;

/** The synchronous registration's parameter type. */
export type DatabaseModuleSyncOptions<TDatabase extends object = object> =
  DatabaseModuleOptions<TDatabase> & DatabaseModuleExtras;

/** The asynchronous registration's parameter type. */
export type DatabaseModuleRegistrationAsyncOptions<TDatabase extends object = object> =
  ConfigurableModuleAsyncOptions<DatabaseModuleOptions<TDatabase>> & Partial<DatabaseModuleExtras>;
