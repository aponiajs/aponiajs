import { ConfigurableModuleBuilder } from "@aponiajs/common";
import type { ConfigurableModuleAsyncOptions, InjectionToken } from "@aponiajs/common";
import type { IdempotencyModuleOptions } from "./interfaces/idempotency-store.interface.ts";

/** Extras shaping the `IdempotencyModule` dynamic module definition. */
export interface IdempotencyModuleExtras {
  /** Makes `IDEMPOTENCY_STORE` visible without re-importing. Defaults to `false`. */
  readonly isGlobal?: boolean;
}

const builder = new ConfigurableModuleBuilder<IdempotencyModuleOptions>({
  moduleName: "Idempotency",
})
  .setExtras<IdempotencyModuleExtras>({ isGlobal: false }, (definition, extras) => ({
    ...definition,
    global: extras.isGlobal ?? false,
  }))
  .build();

export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = builder;

/** The options token for `IdempotencyModule`. */
export const MODULE_OPTIONS_TOKEN: InjectionToken<IdempotencyModuleOptions> =
  builder.MODULE_OPTIONS_TOKEN as InjectionToken<IdempotencyModuleOptions>;

/** Synchronous registration options. */
export type IdempotencyModuleSyncOptions = IdempotencyModuleOptions & IdempotencyModuleExtras;

/** Asynchronous registration options. */
export type IdempotencyModuleRegistrationAsyncOptions =
  ConfigurableModuleAsyncOptions<IdempotencyModuleOptions> & Partial<IdempotencyModuleExtras>;
