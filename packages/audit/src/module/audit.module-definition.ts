import { ConfigurableModuleBuilder } from "@aponiajs/common";
import type { ConfigurableModuleAsyncOptions, InjectionToken } from "@aponiajs/common";
import type { AuditModuleOptions } from "../interfaces/audit.interface.ts";

/**
 * Options that shape the module definition rather than the injected audit
 * options, mirroring the `isGlobal` extra every Nest configurable module states.
 */
export interface AuditModuleExtras {
  /** Makes the registration's exports visible without an import. Defaults to false. */
  readonly isGlobal?: boolean;
}

const builder = new ConfigurableModuleBuilder<AuditModuleOptions>({ moduleName: "Audit" })
  .setExtras<AuditModuleExtras>({ isGlobal: false }, (definition, extras) => ({
    ...definition,
    global: extras.isGlobal ?? false,
  }))
  .build();

/**
 * The generated registration class, options token, and type markers.
 *
 * `MODULE_OPTIONS_TOKEN` is the `AUDIT_MODULE_OPTIONS` token; `OPTIONS_TYPE`
 * and `ASYNC_OPTIONS_TYPE` are type markers that throw when read as values.
 */
export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = builder;

/** The options token, narrowed to the explicit token the builder mints. */
export const MODULE_OPTIONS_TOKEN: InjectionToken<AuditModuleOptions> =
  builder.MODULE_OPTIONS_TOKEN as InjectionToken<AuditModuleOptions>;

/** The synchronous registration's parameter type. */
export type AuditModuleSyncOptions = AuditModuleOptions & AuditModuleExtras;

/** The asynchronous registration's parameter type. */
export type AuditModuleRegistrationAsyncOptions =
  ConfigurableModuleAsyncOptions<AuditModuleOptions> & Partial<AuditModuleExtras>;
