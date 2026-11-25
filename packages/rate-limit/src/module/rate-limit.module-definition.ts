import { ConfigurableModuleBuilder } from "@aponiajs/common";
import type { ConfigurableModuleAsyncOptions, InjectionToken } from "@aponiajs/common";
import type { RateLimitOptions } from "./rate-limit.interface.ts";

/**
 * Options that shape the module definition rather than the injected rate-limit
 * options, mirroring the `isGlobal` extra every Nest configurable module states.
 */
export interface RateLimitModuleExtras {
  /** Makes the registration's exports visible without an import. Defaults to false. */
  readonly isGlobal?: boolean;
}

const builder = new ConfigurableModuleBuilder<RateLimitOptions>({
  moduleName: "RateLimit",
})
  .setExtras<RateLimitModuleExtras>({ isGlobal: false }, (definition, extras) => ({
    ...definition,
    global: extras.isGlobal ?? false,
  }))
  .build();

/**
 * The generated registration class, options token, and type markers.
 *
 * `MODULE_OPTIONS_TOKEN` is the `RATE_LIMIT_MODULE_OPTIONS` token;
 * `OPTIONS_TYPE` and `ASYNC_OPTIONS_TYPE` are type markers that throw when read
 * as values, exactly as Nest's builder emits them.
 */
export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = builder;

/** The options token, narrowed to the explicit token the builder mints. */
export const MODULE_OPTIONS_TOKEN: InjectionToken<RateLimitOptions> =
  builder.MODULE_OPTIONS_TOKEN as InjectionToken<RateLimitOptions>;

/** The synchronous registration's parameter type. */
export type RateLimitModuleSyncOptions = RateLimitOptions & RateLimitModuleExtras;

/** The asynchronous registration's parameter type. */
export type RateLimitModuleRegistrationAsyncOptions =
  ConfigurableModuleAsyncOptions<RateLimitOptions> & Partial<RateLimitModuleExtras>;
