/**
 * `@aponiajs/tenancy` — request-scoped multi-tenancy.
 *
 * The package owns a tenant service, a tenant guard, and the safe identifier
 * policy. It mounts no route and stores no tenant registry.
 */
export { TenantModule } from "./tenancy.module.ts";
export {
  MODULE_OPTIONS_TOKEN,
  type TenancyModuleExtras,
  type TenancyModuleRegistrationAsyncOptions,
  type TenancyModuleSyncOptions,
} from "./tenancy.module-definition.ts";
export { TenantGuard } from "./tenant.guard.ts";
export { TenantService } from "./tenant.service.ts";
export { TENANT } from "./tenant.constants.ts";
export type {
  TenantModuleAsyncOptions,
  TenantModuleOptions,
  TenantPrincipal,
} from "./interfaces/tenancy.interface.ts";
