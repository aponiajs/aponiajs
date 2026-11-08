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
        provideClass(TenantGuard, [TenantService, TENANT_OPTIONS]),
      ]),
      exports: Object.freeze([TenantService, TenantGuard]),
    });
  }
}

function resolveOptions(options: TenantModuleOptions): ResolvedTenantOptions {
  const header = (options.header ?? "x-tenant-id").toLowerCase();
  const required = options.required ?? true;
  const pattern = options.pattern ?? /^[A-Za-z0-9._:-]{1,128}$/;

  if (header.trim() === "") {
    throw invalid("header must be a non-empty string");
  }
  if (typeof required !== "boolean") {
    throw invalid("required must be a boolean");
  }
  if (!(pattern instanceof RegExp)) {
    throw invalid("pattern must be a RegExp");
  }
  if (options.resolver !== undefined && typeof options.resolver !== "function") {
    throw invalid("resolver must be a function");
  }

  return Object.freeze({ header, required, pattern, resolver: options.resolver });
}

function invalid(issue: string): AponiaError {
  return new AponiaError(
    "INVALID_TENANCY_OPTIONS",
    `The tenancy registration is invalid: ${issue}.`,
    { issues: Object.freeze([issue]) },
  );
}
