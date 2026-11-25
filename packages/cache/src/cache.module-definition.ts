import { ConfigurableModuleBuilder } from "@aponiajs/common";
import type { ConfigurableModuleAsyncOptions, InjectionToken } from "@aponiajs/common";
import type { CacheModuleOptions } from "./interfaces/cache-module.interface.ts";

/**
 * Options that shape the module definition rather than the injected cache
 * options, mirroring `@nestjs/cache-manager`'s `isGlobal` extra.
 */
export interface CacheModuleExtras {
  /** Makes the registration's exports visible without an import. Defaults to false. */
  readonly isGlobal?: boolean;
}

const builder = new ConfigurableModuleBuilder<CacheModuleOptions>({ moduleName: "Cache" })
  .setExtras<CacheModuleExtras>({ isGlobal: false }, (definition, extras) => ({
    ...definition,
    global: extras.isGlobal ?? false,
  }))
  .build();

/**
 * The generated registration class, options token, and type markers.
 *
 * `MODULE_OPTIONS_TOKEN` is the Nest-compatible `CACHE_MODULE_OPTIONS` token;
 * `OPTIONS_TYPE` and `ASYNC_OPTIONS_TYPE` are type markers that throw when read
 * as values, exactly as Nest's builder emits them.
 */
export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = builder;

/**
 * The options token, narrowed to the concrete token type.
 *
 * The builder publishes it as the `Token<T>` union (a string, a symbol, a class,
 * or an explicit token), and a dependency list typed through that union loses
 * the value type. A factory provider reads this token, so it is declared as the
 * explicit token the builder actually mints.
 */
export const MODULE_OPTIONS_TOKEN: InjectionToken<CacheModuleOptions> =
  builder.MODULE_OPTIONS_TOKEN as InjectionToken<CacheModuleOptions>;

/** The synchronous registration's parameter type. */
export type CacheModuleSyncOptions = CacheModuleOptions & CacheModuleExtras;

/** The asynchronous registration's parameter type. */
export type CacheModuleRegistrationAsyncOptions =
  ConfigurableModuleAsyncOptions<CacheModuleOptions> & Partial<CacheModuleExtras>;
