import { ConfigurableModuleBuilder } from "@aponiajs/common";
import type { ConfigurableModuleAsyncOptions, InjectionToken } from "@aponiajs/common";
import type { RedisModuleOptions } from "./interfaces/redis-client.interface.ts";

/** Extras shaping the `RedisModule` dynamic module definition. */
export interface RedisModuleExtras {
  /** Makes `RedisService` and `REDIS_CLIENT` visible globally. Defaults to `true`. */
  readonly isGlobal?: boolean;
}

const builder = new ConfigurableModuleBuilder<RedisModuleOptions>({
  moduleName: "Redis",
})
  .setExtras<RedisModuleExtras>({ isGlobal: true }, (definition, extras) => ({
    ...definition,
    global: extras.isGlobal ?? true,
  }))
  .build();

export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = builder;

/** The options token for `RedisModule`. */
export const MODULE_OPTIONS_TOKEN: InjectionToken<RedisModuleOptions> =
  builder.MODULE_OPTIONS_TOKEN as InjectionToken<RedisModuleOptions>;

/** Synchronous registration options. */
export type RedisModuleSyncOptions = RedisModuleOptions & RedisModuleExtras;

/** Asynchronous registration options. */
export type RedisModuleRegistrationAsyncOptions =
  ConfigurableModuleAsyncOptions<RedisModuleOptions> & Partial<RedisModuleExtras>;
