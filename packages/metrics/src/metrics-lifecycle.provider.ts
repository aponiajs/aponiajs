import type { RequestLifecycleHook } from "@aponiajs/common";
import type { ResolvedMetricsOptions } from "./interfaces/metrics.interface.ts";
import { PROMETHEUS_CONTENT_TYPE } from "./metrics.constants.ts";
import type { MetricsService } from "./metrics.service.ts";

/**
 * Creates the opt-in request lifecycle hook that serves the `/metrics`
 * exposition endpoint and records HTTP request latency/status histograms.
 */
export function createMetricsLifecycleHook(
  options: ResolvedMetricsOptions,
  metrics: MetricsService,
): RequestLifecycleHook {
  return {
    name: "metrics",
    async onRequest(request: Request): Promise<Response | undefined> {
      if (!options.exposeEndpoint || request.method !== "GET") {
        return undefined;
      }
      const pathname = extractPathname(request.url);
      if (pathname !== options.path) {
        return undefined;
      }
      if (options.authorize !== undefined && !(await options.authorize(request))) {
        return new Response("Forbidden", { status: 403 });
      }
      return new Response(metrics.render(), {
        status: 200,
        headers: {
          "content-type": PROMETHEUS_CONTENT_TYPE,
          "cache-control": "no-store",
        },
      });
    },
    async wrap(request: Request, next: (request: Request) => Promise<Response>): Promise<Response> {
      if (!options.collectHttpMetrics) {
        return await next(request);
      }
      const pathname = extractPathname(request.url);
      if (options.exposeEndpoint && pathname === options.path) {
        return await next(request);
      }
      const startedAt = performance.now();
      let status = 500;
      try {
        const response = await next(request);
        status = response.status;
        return response;
      } finally {
        const durationSeconds = (performance.now() - startedAt) / 1000;
        metrics.recordHttpRequest(request.method, pathname, status, durationSeconds);
      }
    },
  };
}

function extractPathname(url: string): string {
  const schemeIndex = url.indexOf("://");
  const pathStart = schemeIndex === -1 ? 0 : url.indexOf("/", schemeIndex + 3);
  if (pathStart === -1) {
    return "/";
  }
  const queryIndex = url.indexOf("?", pathStart);
  return queryIndex === -1 ? url.slice(pathStart) : url.slice(pathStart, queryIndex);
}
