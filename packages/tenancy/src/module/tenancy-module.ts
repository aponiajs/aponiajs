import {
  AponiaError,
  Module,
  provideClass,
  provideValue,
  type DynamicModule,
} from "@aponiajs/common";
import { RequestContextModule, RequestContextService } from "@aponiajs/platform-elysia";
import { TenantGuard } from "../guard/tenant.guard.ts";
import { TenantService } from "../service/tenant.service.ts";
import { TENANT_OPTIONS } from "./tenancy.constants.ts";
import type { TenantModuleOptions, ResolvedTenantOptions } from "./tenancy.types.ts";

/** Provides the tenant service and its guard. */
@Module({})
export class TenantModule {
  /** Builds one tenancy registration. */
  static register(options: TenantModuleOptions = {}): DynamicModule {
    const resolved = resolveOptions(options);
    return Object.freeze({
      module: TenantModule,
      id: "TenantModule",
      instanceId: Symbol("TenantModule"),
      imports: Object.freeze([RequestContextModule.forRoot()]),
      controllers: Object.freeze([]),
      providers: Object.freeze([
        provideValue(TENANT_OPTIONS, resolved),
        provideClass(TenantService, [RequestContextService]),
        provideClass(TenantGuard, [TenantService, TENANT_OPTIONS, RequestContextService]),
      ]),
      exports: Object.freeze([TenantService, TenantGuard]),
    });
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
