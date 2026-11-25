import { matchedRouteOf, type RequestLifecycleHook } from "@aponiajs/platform-core";
import { metricsContentType } from "./registry/metrics.constants.ts";
import { MetricsRegistry } from "./registry/metrics.registry.ts";
import type { MetricsPluginOptions } from "./metrics-plugin.types.ts";

interface RecordedRequest {
  readonly request: Request;
  readonly status: number;
}

/**
 * Builds the instrumentation one registration contributes.
 *
 * The hook observes the request boundary, so it runs on every platform: it
 * stamps the arrival, records the status and duration at the answer, and
 * records a failure before the route's filters. The route label is the matched
 * route template the platform records, never the raw path, so a dynamic route
 * stays one series.
 *
 * @param options - The registry, prefix, caps, process metrics, and exclusions.
 * @returns The hook the module registers, and the registry it records into.
 */
export function createMetricsInstrumentation(options: MetricsPluginOptions = {}): {
  readonly hook: RequestLifecycleHook;
  readonly registry: MetricsRegistry;
} {
  const registry =
    options.registry ??
    new MetricsRegistry({
      ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
      ...(options.maxSeriesPerMetric === undefined
        ? {}
        : { maxSeriesPerMetric: options.maxSeriesPerMetric }),
      ...(options.buckets === undefined ? {} : { buckets: options.buckets }),
    });
  const requests = registry.counter("http_requests_total", {
    help: "Total HTTP requests observed by the application.",
  });
  const duration = registry.histogram("http_request_duration_seconds", {
    help: "HTTP request duration in seconds.",
  });
  if (options.processMetrics ?? true) {
    const uptime = registry.gauge("process_uptime_seconds", {
      help: "Process uptime in seconds.",
    });
    const resident = registry.gauge("process_resident_memory_bytes", {
      help: "Resident memory in bytes.",
    });
    const heap = registry.gauge("process_heap_used_bytes", {
      help: "Heap memory in use, in bytes.",
    });
    registry.registerCollector(() => {
      const memory = process.memoryUsage();
      uptime.set(process.uptime());
      resident.set(memory.rss);
      heap.set(memory.heapUsed);
    });
  }

  const starts = new WeakMap<Request, number>();
  const settled = new WeakSet<Request>();
  const path = normalizePath(options.path ?? "/metrics");
  const excluded = new Set([path, ...(options.exclude ?? []).map(normalizePath)]);

  const record = ({ request, status }: RecordedRequest): void => {
    if (settled.has(request)) {
      return;
    }
    settled.add(request);
    const route = routeOf(request);
    if (excluded.has(route)) {
      return;
    }
    const start = starts.get(request);
    const seconds = start === undefined ? 0 : (performance.now() - start) / 1_000;
    requests.inc({ method: request.method, route, status: String(status) });
    duration.observe(seconds, { method: request.method, route });
  };

  return Object.freeze({
    registry,
    hook: Object.freeze({
      name: "metrics",
      onRequest(request: Request): undefined {
        starts.set(request, performance.now());
        return undefined;
      },
      onResponse(request: Request, response: Response): void {
        record({ request, status: response.status });
      },
      onError(request: Request, error: unknown): void {
        record({ request, status: statusOfError(error) });
      },
    }),
  });
}

/**
 * Builds the scrape answer one registration serves.
 *
 * A controller route calls this; rendering runs once per scrape, after the
 * authorization hook, and a denied scrape never renders collectors.
 */
export async function renderMetricsScrape(
  request: Request,
  options: MetricsPluginOptions,
  registry: MetricsRegistry,
): Promise<Response> {
  if (options.authorize !== undefined && !(await options.authorize(request))) {
    return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
  }
  return new Response(registry.render(), {
    status: 200,
    headers: { "content-type": metricsContentType, "cache-control": "no-store" },
  });
}

function routeOf(request: Request): string {
  const matched = matchedRouteOf(request);
  if (matched !== undefined && matched !== "") {
    return matched;
  }
  try {
    return new URL(request.url).pathname;
  } catch {
    return "unmatched";
  }
}

function statusOfError(error: unknown): number {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { readonly status?: unknown; readonly statusCode?: unknown };
    if (typeof candidate.status === "number") {
      return candidate.status;
    }
    if (typeof candidate.statusCode === "number") {
      return candidate.statusCode;
    }
  }
  return 500;
}

function normalizePath(path: string): string {
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}
