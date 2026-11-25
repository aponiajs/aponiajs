import { createToken } from "@aponiajs/common";
import type { ResolvedTenantOptions } from "./interfaces/tenancy.interface.ts";

/** The resolved options the guard reads. */
export const TENANT_OPTIONS = createToken<ResolvedTenantOptions>("aponia.tenancy.options");
