import { AponiaError, Inject, Injectable } from "@aponiajs/common";
import { RequestContextService } from "@aponiajs/platform-elysia";
import { TENANT } from "./tenant.constants.ts";

/** The request-scoped tenant id. */
@Injectable()
export class TenantService {
  readonly #requestContext: RequestContextService;

  /** @internal Construct through `TenantModule.register`. */
  constructor(@Inject(RequestContextService) requestContext: RequestContextService) {
    this.#requestContext = requestContext;
  }

  /** The tenant id the current request resolved, if any. */
  current(): string | undefined {
    return this.#requestContext.current()?.get(TENANT);
  }

  /** The tenant id, or a structured failure when it is absent. */
  require(): string {
    const tenant = this.current();
    if (tenant === undefined) {
      throw new AponiaError("MISSING_TENANT", "No tenant is selected for this request.");
    }
    return tenant;
  }

  /** @internal Enters the tenant into the request context. */
  enter(tenant: string): void {
    this.#requestContext.current()?.set(TENANT, tenant);
  }
}
