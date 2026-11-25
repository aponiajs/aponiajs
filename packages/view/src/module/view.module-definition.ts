import { ConfigurableModuleBuilder } from "@aponiajs/common";
import type { ConfigurableModuleAsyncOptions, InjectionToken } from "@aponiajs/common";
import type { ViewModuleOptions } from "../interfaces/view.interface.ts";

/**
 * Options that shape the module definition rather than the injected view
 * options, mirroring the `isGlobal` extra every Nest configurable module states.
 */
export interface ViewModuleExtras {
  /**
   * Makes the registration's exports visible without an import.
   *
   * Defaults to true: a view engine is a rendering surface every module reads,
   * and the registration was already declared global before it used the builder.
   */
  readonly isGlobal?: boolean;
}

const builder = new ConfigurableModuleBuilder<ViewModuleOptions>({ moduleName: "View" })
  .setExtras<ViewModuleExtras>({ isGlobal: true }, (definition, extras) => ({
    ...definition,
    global: extras.isGlobal ?? true,
  }))
  .build();

/**
 * The generated registration class, options token, and type markers.
 *
 * `MODULE_OPTIONS_TOKEN` is the `VIEW_MODULE_OPTIONS` token; `OPTIONS_TYPE` and
 * `ASYNC_OPTIONS_TYPE` are type markers that throw when read as values.
 */
export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = builder;

/** The options token, narrowed to the explicit token the builder mints. */
export const MODULE_OPTIONS_TOKEN: InjectionToken<ViewModuleOptions> =
  builder.MODULE_OPTIONS_TOKEN as InjectionToken<ViewModuleOptions>;

/** The synchronous registration's parameter type. */
export type ViewModuleSyncOptions = ViewModuleOptions & ViewModuleExtras;

/** The asynchronous registration's parameter type. */
export type ViewModuleRegistrationAsyncOptions = ConfigurableModuleAsyncOptions<ViewModuleOptions> &
  Partial<ViewModuleExtras>;
