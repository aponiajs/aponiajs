import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
  type RouteContext,
} from "@aponiajs/common";
import { httpErrors } from "@aponiajs/platform-elysia";
import { TenantService } from "../service/tenant.service.ts";
import { TENANT_OPTIONS } from "../module/tenancy.constants.ts";
import type { ResolvedTenantOptions } from "../module/tenancy.types.ts";

/** Resolves the request tenant from a header or a custom resolver. */
@Injectable()
export class TenantGuard implements CanActivate {
  readonly #service: TenantService;
  readonly #options: ResolvedTenantOptions;

  constructor(
    @Inject(TenantService) service: TenantService,
    @Inject(TENANT_OPTIONS) options: ResolvedTenantOptions,
  ) {
    this.#service = service;
    this.#options = options;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const tenant =
      this.#options.resolver?.(context) ?? request.headers[this.#options.header] ?? undefined;

    if (tenant === undefined) {
      if (this.#options.required) {
        throw httpErrors.badRequest(`Tenant header "${this.#options.header}" is required.`);
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
