import { Elysia } from "elysia";
import { metricsContentType } from "../registry/metrics.constants.ts";
import { MetricsRegistry } from "../registry/metrics-registry.ts";
import type { MetricsPluginOptions } from "./metrics-plugin.types.ts";

interface MetricContext {
  readonly request: Request;
  readonly set: { status?: number | string };
  readonly path?: string;
  readonly route?: string;
  readonly responseValue?: unknown;
}

/**
 * Builds the native plugin that serves a scrape endpoint and instruments every
 * route the application later mounts.
 *
 * The plugin records `http_requests_total` and `http_request_duration_seconds`
 * for each request that reaches a mounted route. Its hooks are declared global,
 * so a route the application mounts stays instrumented even though the plugin
 * itself owns only the scrape path.
 */
export function metricsPlugin(options: MetricsPluginOptions = {}): Elysia {
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
  const path = normalizePath(options.path ?? "/metrics");
  const excluded = new Set([path, ...(options.exclude ?? []).map(normalizePath)]);

  const record = (context: MetricContext, status: number): void => {
    const route = routeOf(context);
    if (excluded.has(route)) {
      return;
    }
    const method = context.request.method;
    const start = starts.get(context.request);
    const seconds = start === undefined ? 0 : (performance.now() - start) / 1_000;
    requests.inc({ method, route, status: String(status) });
    duration.observe(seconds, { method, route });
  };

  return new Elysia({ name: "aponia.metrics" })
    .onBeforeHandle("global", (context) => {
      starts.set(context.request, performance.now());
    })
    .onAfterHandle("global", (context) => {
      record(context, successStatus(context.responseValue, context.set?.status));
    })
    .onError((context) => {
      record(context, errorStatus(context.error, context.set?.status));
    })
    .get(
      path,
      () =>
        new Response(registry.render(), {
          status: 200,
          headers: { "content-type": metricsContentType, "cache-control": "no-store" },
        }),
    ) as unknown as Elysia;
}

function routeOf(context: MetricContext): string {
  if (typeof context.route === "string" && context.route !== "") {
    return context.route;
  }
  if (typeof context.path === "string" && context.path !== "") {
    return context.path;
  }
  try {
    return new URL(context.request.url).pathname;
  } catch {
    return "/";
  }
}

function successStatus(responseValue: unknown, status: number | string | undefined): number {
  if (responseValue instanceof Response) {
    return responseValue.status;
  }
  const statusBox = responseValue as { readonly status?: unknown; readonly response?: unknown };
  if (
    typeof statusBox === "object" &&
    statusBox !== null &&
    typeof statusBox.status === "number" &&
    "response" in statusBox
  ) {
    return statusBox.status;
  }
  return typeof status === "number" ? status : 200;
}

function errorStatus(error: unknown, status: number | string | undefined): number {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { readonly status?: unknown; readonly statusCode?: unknown };
    if (typeof candidate.status === "number") {
      return candidate.status;
    }
    if (typeof candidate.statusCode === "number") {
      return candidate.statusCode;
    }
  }
  return typeof status === "number" ? status : 500;
}

function normalizePath(path: string): string {
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}
