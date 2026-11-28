import { Inject, Injectable } from "@aponiajs/common";
import type { ExecutionContext, Interceptor } from "@aponiajs/common";
import { getCacheKeyMetadata } from "../decorators/cache-key.decorator.ts";
import { getCacheTtlMetadata } from "../decorators/cache-ttl.decorator.ts";
import { CACHE_MANAGER } from "../cache.constants.ts";
import type { CacheService } from "../cache.service.ts";
import type { CacheEntryOptions } from "../interfaces/cache-service.interface.ts";

/**
 * Records a handler's `GET` response in the cache.
 *
 * Only `GET` is cached, matching `@nestjs/cache-manager`. The key is
 * `@CacheKey()`'s value when the handler declares one, otherwise the request's
 * method and URL; `@CacheTTL()` overrides the registration's default lifetime.
 *
 * **Deviation:** this interceptor writes, it does not replay. AponiaJS's
 * interceptor contract has no `next.handle()`, so a cached response cannot be
 * returned in place of running the handler. Read-through belongs to
 * `CacheService.wrap`, which is single-flight per key and therefore the stronger
 * guarantee for a stampede. The package guide states this limitation.
 */
@Injectable()
export class CacheInterceptor implements Interceptor {
  readonly #cache: CacheService;

  constructor(@Inject(CACHE_MANAGER) cache: CacheService) {
    this.#cache = cache;
  }

  /** Stores the handler's answer when the route is a cacheable `GET`. */
  async interceptAfter(context: ExecutionContext, response: unknown): Promise<unknown> {
    if (context.getRoute().method !== "GET" || response === undefined) {
      return response;
    }

    const handler = context.getHandler() as unknown as object;
    const key = getCacheKeyMetadata(handler) ?? requestKey(context);
    const ttlMs = getCacheTtlMetadata(handler);
    const options: CacheEntryOptions = ttlMs === undefined ? {} : { ttlMs };

    await this.#cache.set(key, response, options);
    return response;
  }
}

function requestKey(context: ExecutionContext): string {
  return `GET ${context.switchToHttp().getRequest().request.url}`;
}
