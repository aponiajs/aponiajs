/** The content type a Prometheus scrape expects. */
export const metricsContentType = "text/plain; version=0.0.4; charset=utf-8";

/** The buckets HTTP latency is observed in. */
export const defaultHistogramBuckets = Object.freeze([
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
]);
