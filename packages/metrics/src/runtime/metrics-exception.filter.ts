import { Inject, Injectable, type ExceptionFilter, type ExecutionContext } from "@aponiajs/common";
import { MetricsRegistry } from "../registry/metrics-registry.ts";

/**
 * Records a failed request in `http_requests_total` and declines it, so the
 * response stays whatever the route's own filters and the default Problem
 * Details mapping answer.
 *
 * Declare it as a global filter beside the module:
 *
 * ```ts
 * const application = await AponiaFactory.create(AppModule, {
 *   filters: [MetricsExceptionFilter],
 * });
 * ```
 *
 * The plugin's own hooks never see an exception, because the route answers it.
 */
@Injectable()
export class MetricsExceptionFilter implements ExceptionFilter {
  readonly #requests: ReturnType<MetricsRegistry["counter"]>;

  /** @internal Construct through `MetricsModule.register`. */
  constructor(@Inject(MetricsRegistry) registry: MetricsRegistry) {
    this.#requests = registry.counter("http_requests_total", {
      help: "Total HTTP requests observed by the application.",
    });
  }

  catch(exception: unknown, host: ExecutionContext): undefined {
    const context = host.switchToHttp().getRequest();
    this.#requests.inc({
      method: context.request.method,
      route: context.path,
      status: String(statusOf(exception)),
    });
    return undefined;
  }
}

function statusOf(exception: unknown): number {
  if (typeof exception === "object" && exception !== null) {
    const candidate = exception as { readonly status?: unknown; readonly statusCode?: unknown };
    if (typeof candidate.status === "number") {
      return candidate.status;
    }
    if (typeof candidate.statusCode === "number") {
      return candidate.statusCode;
    }
  }
  return 500;
}
