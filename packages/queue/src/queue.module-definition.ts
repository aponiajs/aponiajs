import { ConfigurableModuleBuilder } from "@aponiajs/common";
import type { ConfigurableModuleAsyncOptions, InjectionToken } from "@aponiajs/common";
import type { QueueModuleOptions } from "./interfaces/queue-module.interface.ts";

/**
 * Options that shape the module definition rather than the injected queue
 * options, mirroring the `isGlobal` extra every Nest configurable module states.
 */
export interface QueueModuleExtras {
  /** Makes the registration's exports visible without an import. Defaults to false. */
  readonly isGlobal?: boolean;
  /** The queue name `@InjectQueue()` resolves; defaults to `default`. */
  readonly name?: string;
}

const builder = new ConfigurableModuleBuilder<QueueModuleOptions>({ moduleName: "Queue" })
  .setExtras<QueueModuleExtras>({ isGlobal: false, name: "default" }, (definition, extras) => ({
    ...definition,
    global: extras.isGlobal ?? false,
  }))
  .build();

/**
 * The generated registration class, options token, and type markers.
 *
 * `MODULE_OPTIONS_TOKEN` is the `QUEUE_MODULE_OPTIONS` token; `OPTIONS_TYPE` and
 * `ASYNC_OPTIONS_TYPE` are type markers that throw when read as values.
 */
export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = builder;

/** The options token, narrowed to the explicit token the builder mints. */
export const MODULE_OPTIONS_TOKEN: InjectionToken<QueueModuleOptions> =
  builder.MODULE_OPTIONS_TOKEN as InjectionToken<QueueModuleOptions>;

/** The synchronous registration's parameter type. */
export type QueueModuleSyncOptions = QueueModuleOptions & QueueModuleExtras;

/** The asynchronous registration's parameter type. */
export type QueueModuleRegistrationAsyncOptions =
  ConfigurableModuleAsyncOptions<QueueModuleOptions> & Partial<QueueModuleExtras>;
