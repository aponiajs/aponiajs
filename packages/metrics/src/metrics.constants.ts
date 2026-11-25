import { createToken } from "@aponiajs/common";
import type { ResolvedMetricsOptions } from "./metrics-plugin.types.ts";

/** The options token every provider and the generated scrape controller read. @internal */
export const METRICS_OPTIONS_TOKEN = createToken<ResolvedMetricsOptions>("aponia.metrics.options");
