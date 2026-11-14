import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
  type RouteContext,
} from "@aponiajs/common";
import { httpErrors, RequestContextService } from "@aponiajs/platform-elysia";
import { TenantService } from "../service/tenant.service.ts";
import { TENANT_OPTIONS } from "../module/tenancy.constants.ts";
import type { ResolvedTenantOptions } from "../module/tenancy.types.ts";

/**
 * Resolves the request tenant from a resolver, a verified principal, or an
 * explicitly configured header, in that order.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  readonly #service: TenantService;
  readonly #options: ResolvedTenantOptions;
  readonly #requestContext: RequestContextService;

  constructor(
    @Inject(TenantService) service: TenantService,
    @Inject(TENANT_OPTIONS) options: ResolvedTenantOptions,
    @Inject(RequestContextService) requestContext: RequestContextService,
  ) {
    this.#service = service;
    this.#options = options;
    this.#requestContext = requestContext;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const principal =
      this.#options.principal === undefined
        ? undefined
        : this.#requestContext.current()?.get(this.#options.principal);
    const claim = principal?.[this.#options.claim];
    const fromPrincipal = typeof claim === "string" ? claim : undefined;
    const fromHeader =
      this.#options.header === undefined
        ? undefined
        : (request.headers[this.#options.header] ?? undefined);
    const tenant = this.#options.resolver?.(context) ?? fromPrincipal ?? fromHeader;

    if (tenant === undefined) {
      if (this.#options.required) {
        throw httpErrors.badRequest("A tenant is required for this request.");
      }
      return true;
    }
    if (!this.#options.pattern.test(tenant)) {
      throw httpErrors.badRequest("Tenant identifier is invalid.");
    }

    this.#service.enter(tenant);
    (request as RouteContext & { tenant?: string }).tenant = tenant;
    return true;
  }
}
