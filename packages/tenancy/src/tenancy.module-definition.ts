import { ConfigurableModuleBuilder } from "@aponiajs/common";
import type { ConfigurableModuleAsyncOptions, InjectionToken } from "@aponiajs/common";
import type { TenantModuleOptions } from "./interfaces/tenancy.interface.ts";

/**
 * Options that shape the module definition rather than the injected tenancy
 * options, mirroring the `isGlobal` extra every Nest configurable module states.
 */
export interface TenancyModuleExtras {
  /** Makes the registration's exports visible without an import. Defaults to false. */
  readonly isGlobal?: boolean;
}

const builder = new ConfigurableModuleBuilder<TenantModuleOptions>({
  moduleName: "Tenancy",
})
  .setExtras<TenancyModuleExtras>({ isGlobal: false }, (definition, extras) => ({
    ...definition,
    global: extras.isGlobal ?? false,
  }))
  .build();

/**
 * The generated registration class, options token, and type markers.
 *
 * `MODULE_OPTIONS_TOKEN` is the `TENANCY_MODULE_OPTIONS` token; `OPTIONS_TYPE`
 * and `ASYNC_OPTIONS_TYPE` are type markers that throw when read as values.
 */
export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = builder;

/** The options token, narrowed to the explicit token the builder mints. */
export const MODULE_OPTIONS_TOKEN: InjectionToken<TenantModuleOptions> =
  builder.MODULE_OPTIONS_TOKEN as InjectionToken<TenantModuleOptions>;

/** The synchronous registration's parameter type. */
export type TenancyModuleSyncOptions = TenantModuleOptions & TenancyModuleExtras;

/** The asynchronous registration's parameter type. */
export type TenancyModuleRegistrationAsyncOptions =
  ConfigurableModuleAsyncOptions<TenantModuleOptions> & Partial<TenancyModuleExtras>;
