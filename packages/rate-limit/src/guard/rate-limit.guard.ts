import {
  Inject,
  Injectable,
  Reflector,
  type CanActivate,
  type ExecutionContext,
} from "@aponiajs/common";
import { httpErrors } from "@aponiajs/platform-elysia";
import { RATE_LIMIT_OPTIONS } from "../module/rate-limit-module.constants.ts";
import type {
  RateLimitDecision,
  RateLimitOverride,
  ResolvedRateLimitOptions,
} from "../module/rate-limit.types.ts";
import { RateLimitService } from "../service/rate-limit.service.ts";
import { rateLimitMetadataKey } from "./rate-limit.decorator.ts";

/**
 * Refuses a request whose bucket has exceeded its limit.
 *
 * The guard reads `@RateLimit()` from the handler first and the controller
 * second. It sets `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`
 * on every answer it allows, and throws a `429` Problem Details answer when the
 * bucket is exhausted.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  readonly #service: RateLimitService;
  readonly #reflector: Reflector;
  readonly #options: ResolvedRateLimitOptions;

  constructor(
    @Inject(RateLimitService) service: RateLimitService,
    @Inject(Reflector) reflector: Reflector,
    @Inject(RATE_LIMIT_OPTIONS) options: ResolvedRateLimitOptions,
  ) {
    this.#service = service;
    this.#reflector = reflector;
    this.#options = options;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const override =
      this.#reflector.getAllAndOverride<RateLimitOverride>(rateLimitMetadataKey, [
        context.getHandler(),
        context.getClass(),
      ]) ?? {};
    const key = this.#keyFor(context, override);
    const decision = await this.#service.check(key, override);
    this.#setHeaders(context, decision);

    if (!decision.allowed) {
      throw httpErrors.tooManyRequests("Rate limit exceeded.");
    }
    return true;
  }

  #keyFor(context: ExecutionContext, override: RateLimitOverride): string {
    if (override.key !== undefined) {
      return override.key(context);
    }
    if (this.#options.key !== undefined) {
      return this.#options.key(context);
    }
    const route = context.getRoute();
    return `${context.getClass().name}.${context.getHandler().name}:${route.method} ${route.path}`;
  }

  #setHeaders(context: ExecutionContext, decision: RateLimitDecision): void {
    const request = context.switchToHttp().getRequest();
    request.set.headers["ratelimit-limit"] = String(decision.limit);
    request.set.headers["ratelimit-remaining"] = String(decision.remaining);
    request.set.headers["ratelimit-reset"] = String(Math.ceil(decision.resetAt / 1_000));
    if (!decision.allowed) {
      // The refusal is the one answer a client acts on, so it also states how
      // long to wait: at least one second, and rounded up so a client does not
      // retry into the same window.
      const retryAfter = Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1_000));
      request.set.headers["retry-after"] = String(retryAfter);
    }
  }
}
