import { Module, dynamicModule, type DynamicModule, type Provider } from "@aponiajs/common";
import {
  provideConfiguration,
  provideHttpPolicyAsync,
  requirePlatformCapabilities,
} from "@aponiajs/common";
import { buildCorsPolicy } from "../policy/cors.policy.ts";
import type { CorsModuleOptions } from "../interfaces/cors-module.interface.ts";

const defaultKey = "cors";

/**
 * The module an application imports to answer cross-origin requests.
 *
 * ```ts
 * const cors = CorsModule.forRoot({ configuration: CorsConfig });
 *
 * @Module({ imports: [cors] })
 * export class AppModule {}
 * ```
 *
 * The policy is built from the validated configuration and runs through the
 * shared request pipeline, so the same registration answers the same headers
 * and the same preflight on every platform. The module provides the
 * configuration it consumes and exports it, so the application that declared
 * the token reads back the same validated value the policy carries.
 */
@Module({})
export class CorsModule {
  /**
   * Builds the CORS module for one application.
   *
   * @param options - The configuration, literal source, and module key.
   * @returns A frozen registration the application's `imports` accepts.
   */
  static forRoot(options: CorsModuleOptions): DynamicModule {
    const { configuration, source, key } = options;

    return registration(
      provideConfiguration(configuration, source === undefined ? undefined : { source }),
      (value) => buildCorsPolicy(value, configuration),
      key ?? defaultKey,
      configuration,
    );
  }

  /**
   * Builds the CORS module for one application.
   *
   * @deprecated Use {@link CorsModule.forRoot}; retained for the beta line.
   */
  static register(options: CorsModuleOptions): DynamicModule {
    return CorsModule.forRoot(options);
  }
}

function registration(
  configurationProvider: Provider,
  build: (value: unknown) => ReturnType<typeof buildCorsPolicy>,
  key: string,
  configuration: CorsModuleOptions["configuration"],
): DynamicModule {
  return dynamicModule({
    module: CorsModule,
    id: `CorsModule[${key}]`,
    instanceId: Symbol.for(`aponia.cors:${key}`),
    providers: [
      configurationProvider,
      provideHttpPolicyAsync([configuration], build),
      requirePlatformCapabilities("cors", ["http"]),
    ],
    exports: [configuration],
  });
}
