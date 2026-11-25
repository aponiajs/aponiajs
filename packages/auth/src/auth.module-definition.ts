import {
  APP_GUARD,
  ConfigurableModuleBuilder,
  provideValue,
  type InjectionToken,
  type Provider,
} from "@aponiajs/common";
import { AuthGuard } from "./auth.guard.ts";
import type { AuthModuleOptions } from "./interfaces/auth.interface.ts";

/**
 * Options that shape the module definition rather than the injected auth
 * options, mirroring `@nestjs/authentication`'s `isGlobal` and `globalGuard`.
 */
export interface AuthModuleExtras {
  /** Makes the registration's exports visible without an import. Defaults to true. */
  readonly isGlobal?: boolean;
  /** Registers `AuthGuard` as a global guard. Defaults to true. */
  readonly globalGuard?: boolean;
}

const builder = new ConfigurableModuleBuilder<AuthModuleOptions>({ moduleName: "Auth" })
  .setExtras<AuthModuleExtras>({ isGlobal: true, globalGuard: true }, (definition, extras) => ({
    ...definition,
    global: extras.isGlobal ?? true,
    providers: [
      ...(definition.providers ?? []),
      ...(extras.globalGuard === false ? [] : [provideValue(APP_GUARD, AuthGuard) as Provider]),
    ],
  }))
  .build();

/**
 * The generated registration class, options token, and type markers.
 *
 * `MODULE_OPTIONS_TOKEN` is the `AUTH_MODULE_OPTIONS` token; `OPTIONS_TYPE` and
 * `ASYNC_OPTIONS_TYPE` are type markers that throw when read as values.
 *
 * This package's registration is shaped by its options: the verification arm
 * decides which verifier provider exists, which a container factory cannot
 * change. `forRoot` is therefore the only registration, and the generated
 * `registerAsync` is not exposed as a public surface.
 */
export const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } = builder;

/** The options token, narrowed to the explicit token the builder mints. */
export const MODULE_OPTIONS_TOKEN: InjectionToken<AuthModuleOptions> =
  builder.MODULE_OPTIONS_TOKEN as InjectionToken<AuthModuleOptions>;

/** The synchronous registration's parameter type. */
export type AuthModuleSyncOptions = AuthModuleOptions & AuthModuleExtras;
