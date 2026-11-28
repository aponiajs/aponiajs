import { createToken, type InjectionToken } from "@aponiajs/common";
import type { ResolvedMetricsOptions } from "./interfaces/metrics.interface.ts";

/** Internal token carrying validated metrics options. */
export const METRICS_OPTIONS: InjectionToken<ResolvedMetricsOptions> =
  createToken<ResolvedMetricsOptions>("METRICS_OPTIONS");

/** Prometheus text exposition content type (v0.0.4). */
export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/** Default histogram buckets in seconds for HTTP request latency. */
export const DEFAULT_HTTP_BUCKETS: readonly number[] = Object.freeze([
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
]);
