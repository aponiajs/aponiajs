import { Module, type DynamicModule } from "@aponiajs/common";
import { PluginModule } from "@aponiajs/platform-elysia";
import { buildSecurityPlugin, resolveSecurityPolicy } from "../policy/security-policy.ts";
import type { SecurityModuleOptions } from "./security.types.ts";

/** Mounts the security headers and CSRF policy. */
@Module({})
export class SecurityModule {
  /**
   * Builds a security registration.
   *
   * @param options - Header policy, CSRF policy, and module key.
   * @returns The plugin registration an application imports.
   * @throws An `AponiaError` with `INVALID_SECURITY_OPTIONS` when an option is invalid.
   */
  static register(options: SecurityModuleOptions = {}): DynamicModule {
    const policy = resolveSecurityPolicy(options);
    return PluginModule.register(buildSecurityPlugin(policy), {
      key: options.key ?? "security",
    });
  }
}
