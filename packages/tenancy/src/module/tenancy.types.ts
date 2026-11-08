import type { ExecutionContext } from "@aponiajs/common";

/** Options `TenantModule.register` accepts. */
export interface TenantModuleOptions {
  /** The header carrying the tenant id; defaults to `x-tenant-id`. */
  readonly header?: string;
  /** Whether a missing tenant rejects the request; defaults to true. */
  readonly required?: boolean;
  /** The accepted tenant-id shape; defaults to a safe 1-128 character segment. */
  readonly pattern?: RegExp;
  /** A resolver overriding the header, for example from an authenticated JWT claim. */
  readonly resolver?: (context: ExecutionContext) => string | undefined;
}

/** The validated options the guard reads. */
export interface ResolvedTenantOptions {
  readonly header: string;
  readonly required: boolean;
  readonly pattern: RegExp;
  readonly resolver: ((context: ExecutionContext) => string | undefined) | undefined;
}
