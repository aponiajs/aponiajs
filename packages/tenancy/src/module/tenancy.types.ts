import type { ExecutionContext, InjectionToken } from "@aponiajs/common";

/** A verified principal stored in the request context. */
export type TenantPrincipal = Readonly<Record<string, unknown>>;

/** Options `TenantModule.register` accepts. */
export interface TenantModuleOptions {
  /**
   * The header carrying the tenant id. Omit it to read no header; a header is
   * selection, not authorization, so it is opt-in.
   */
  readonly header?: string;
  /** Whether a missing tenant rejects the request; defaults to true. */
  readonly required?: boolean;
  /** The accepted tenant-id shape; defaults to a safe 1-128 character segment. */
  readonly pattern?: RegExp;
  /** A resolver overriding every other source, for example from an auth guard. */
  readonly resolver?: (context: ExecutionContext) => string | undefined;
  /** A request-context token holding the verified principal. */
  readonly principal?: InjectionToken<TenantPrincipal>;
  /** The principal claim naming the tenant; defaults to `tenantId`. */
  readonly claim?: string;
}

/** The validated options the guard reads. */
export interface ResolvedTenantOptions {
  readonly header: string | undefined;
  readonly required: boolean;
  readonly pattern: RegExp;
  readonly resolver: ((context: ExecutionContext) => string | undefined) | undefined;
  readonly principal: InjectionToken<TenantPrincipal> | undefined;
  readonly claim: string;
}
