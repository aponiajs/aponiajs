import {
  AponiaError,
  Module,
  provideClass,
  provideFactory,
  type DynamicModule,
  type Provider,
} from "@aponiajs/common";
import { RequestContextModule, RequestContextService } from "@aponiajs/platform-core";
import { TenantGuard } from "./tenant.guard.ts";
import { TenantService } from "./tenant.service.ts";
import { TENANT_OPTIONS } from "./tenancy.constants.ts";
import type { ResolvedTenantOptions, TenantModuleOptions } from "./interfaces/tenancy.interface.ts";
import {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  type TenancyModuleExtras,
  type TenancyModuleRegistrationAsyncOptions,
  type TenancyModuleSyncOptions,
} from "./tenancy.module-definition.ts";

/** Provides the tenant service and its guard. */
@Module({})
export class TenantModule extends ConfigurableModuleClass {
  /**
   * Builds one tenancy registration.
   *
   * @param options - The tenant source, policy, and claim name.
   * @returns A frozen dynamic module an application imports.
   * @throws An `AponiaError` with `INVALID_TENANCY_OPTIONS` when an option is invalid.
   */
  static forRoot(options: TenancyModuleSyncOptions = {}): DynamicModule {
    resolveOptions(options);
    assertExtras(options);
    return registration(super.register(options));
  }

  /**
   * Builds a tenancy registration whose options a factory, a class, or an
   * existing provider resolves.
   *
   * The options are resolved once when the options token first resolves, and
   * validated then, so a refused boot names the same issues `forRoot` reports.
   *
   * @param options - The imports, injected tokens, factory, extras, and extra providers.
   * @returns A frozen dynamic module an application imports.
   */
  static forRootAsync(options: TenancyModuleRegistrationAsyncOptions): DynamicModule {
    assertExtras(options);
    return registration(super.registerAsync(options), options.extraProviders);
  }

  /**
   * Builds one tenancy registration.
   *
   * @deprecated Use {@link TenantModule.forRoot}; retained for the beta line.
   */
  static override register(options: TenancyModuleSyncOptions = {}): DynamicModule {
    return TenantModule.forRoot(options);
  }

  /**
   * Builds a tenancy registration whose options a factory resolves.
   *
   * @deprecated Use {@link TenantModule.forRootAsync}; retained for the beta line.
   */
  static override registerAsync(options: TenancyModuleRegistrationAsyncOptions): DynamicModule {
    return TenantModule.forRootAsync(options);
  }
}

function registration(
  definition: DynamicModule,
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  const contextRegistration = RequestContextModule.forRoot();
  return Object.freeze({
    ...definition,
    module: TenantModule,
    imports: Object.freeze([contextRegistration, ...(definition.imports ?? [])]),
    controllers: Object.freeze([...(definition.controllers ?? [])]),
    providers: Object.freeze([
      ...(definition.providers ?? []),
      provideFactory(TENANT_OPTIONS, [MODULE_OPTIONS_TOKEN], (options: TenantModuleOptions) =>
        resolveOptions(options),
      ),
      provideClass(TenantService, [RequestContextService]),
      provideClass(TenantGuard, [TenantService, TENANT_OPTIONS, RequestContextService]),
      ...extraProviders,
    ]),
    exports: Object.freeze([MODULE_OPTIONS_TOKEN, TenantService, TenantGuard]),
  });
}

function assertExtras(options: Partial<TenancyModuleExtras>): void {
  if (options.isGlobal !== undefined && typeof options.isGlobal !== "boolean") {
    throw invalid(["isGlobal must be a boolean"]);
  }
}

function resolveOptions(options: TenantModuleOptions): ResolvedTenantOptions {
  const header = options.header?.toLowerCase();
  const required = options.required ?? true;
  const pattern = options.pattern ?? /^[A-Za-z0-9._:-]{1,128}$/;
  const principal = options.principal;
  const claim = options.claim ?? "tenantId";
  const issues: string[] = [];

  if (header === undefined && options.resolver === undefined && principal === undefined) {
    issues.push("one of header, resolver, or principal must be provided");
  }
  if (header !== undefined && header.trim() === "") {
    issues.push("header must be a non-empty string");
  }
  if (typeof required !== "boolean") {
    issues.push("required must be a boolean");
  }
  if (!(pattern instanceof RegExp)) {
    issues.push("pattern must be a RegExp");
  }
  if (options.resolver !== undefined && typeof options.resolver !== "function") {
    issues.push("resolver must be a function");
  }
  if (
    principal !== undefined &&
    (typeof principal !== "object" ||
      principal === null ||
      typeof (principal as { readonly id?: unknown }).id !== "symbol")
  ) {
    issues.push("principal must be an injection token");
  }
  if (typeof claim !== "string" || claim.trim() === "") {
    issues.push("claim must be a non-empty string");
  }
  if (issues.length > 0) {
    throw invalid(issues);
  }

  return Object.freeze({
    header,
    required,
    pattern,
    resolver: options.resolver,
    principal,
    claim,
  });
}

function invalid(issues: readonly string[]): AponiaError {
  return new AponiaError(
    "INVALID_TENANCY_OPTIONS",
    `The tenancy registration is invalid: ${issues.join("; ")}.`,
    { issues: Object.freeze([...issues]) },
  );
}
