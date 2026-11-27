import {
  Module,
  createToken,
  dynamicModule,
  moduleOptionsProviders,
  provideValue,
  type DynamicModule,
  type ModuleAsyncOptions,
  type ModuleImport,
  type Provider,
} from "@aponiajs/common";
import { provideHttpPoliciesAsync, requirePlatformCapabilities } from "@aponiajs/common";
import {
  buildSecurityPolicies,
  resolveSecurityPolicy,
  type ResolvedSecurityPolicy,
} from "../policy/security.policy.ts";
import type { SecurityModuleOptions } from "../interfaces/security.interface.ts";

const defaultKey = "security";

const SECURITY_RESOLVED = createToken<ResolvedSecurityPolicy>("aponia.plugin.security.resolved");

/** Contributes the header policy and, when enabled, the CSRF policy. */
@Module({})
export class SecurityModule {
  /**
   * Builds a security registration.
   *
   * @param options - Header policy, CSRF policy, and module key.
   * @returns The module registration an application imports.
   * @throws An `AponiaError` with `INVALID_SECURITY_OPTIONS` when an option is invalid.
   */
  static forRoot(options: SecurityModuleOptions = {}): DynamicModule {
    return registration(
      [provideValue(SECURITY_RESOLVED, resolveSecurityPolicy(options))],
      options.key ?? defaultKey,
    );
  }

  /**
   * Builds a security registration whose options a factory resolves.
   *
   * `key` names the module identity before the container runs, so it is read
   * from the registration rather than from the factory result.
   *
   * @param options - The imports, injected tokens, factory, key, and extra providers.
   * @returns The module registration an application imports.
   */
  static forRootAsync(
    options: ModuleAsyncOptions<SecurityModuleOptions> & { readonly key?: string },
  ): DynamicModule {
    return registration(
      moduleOptionsProviders(SECURITY_RESOLVED, options, (resolved) =>
        resolveSecurityPolicy(resolved),
      ),
      options.key ?? defaultKey,
      options.imports,
      options.extraProviders,
    );
  }

  /**
   * Builds a security registration.
   *
   * @deprecated Use {@link SecurityModule.forRoot}; retained for the beta line.
   */
  static register(options: SecurityModuleOptions = {}): DynamicModule {
    return SecurityModule.forRoot(options);
  }
}

function registration(
  resolvedProviders: readonly Provider[],
  key: string,
  imports: readonly ModuleImport[] = [],
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  return dynamicModule({
    module: SecurityModule,
    id: `SecurityModule[${key}]`,
    instanceId: Symbol.for(`aponia.security:${key}`),
    imports,
    providers: [
      ...resolvedProviders,
      provideHttpPoliciesAsync([SECURITY_RESOLVED], (policy) => buildSecurityPolicies(policy)),
      requirePlatformCapabilities("security", ["http"]),
      ...extraProviders,
    ],
    exports: [],
  });
}
