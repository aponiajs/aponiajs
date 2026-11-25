import { Controller, Get, Inject, Req } from "@aponiajs/common";
import { METRICS_OPTIONS_TOKEN } from "./metrics.constants.ts";
import { renderMetricsScrape } from "./metrics-instrumentation.ts";
import type { ResolvedMetricsOptions } from "./metrics-plugin.types.ts";

/**
 * Builds the controller one registration mounts its scrape route on.
 *
 * The class is generated per registration because the scrape path is a
 * registration option, and a route path is fixed when the class is decorated.
 * The options arrive through `@Inject`, so an asynchronous registration's
 * factory result is what the handler reads.
 *
 * @internal
 */
export function createMetricsController(
  path: string,
): new (options: ResolvedMetricsOptions) => { scrape(request: Request): Promise<Response> } {
  class MetricsScrapeController {
    readonly #options: ResolvedMetricsOptions;

    constructor(options: ResolvedMetricsOptions) {
      this.#options = options;
    }

    scrape(request: Request): Promise<Response> {
      return renderMetricsScrape(request, this.#options, this.#options.registry);
    }
  }

  Controller()(MetricsScrapeController);
  // The decorator factories are declared as method decorators; applying one to
  // a generated class writes the same metadata the decorator syntax writes.
  (Get(path) as unknown as (target: object, key: string) => void)(
    MetricsScrapeController.prototype,
    "scrape",
  );
  Req()(MetricsScrapeController.prototype, "scrape", 0);
  Inject(METRICS_OPTIONS_TOKEN)(MetricsScrapeController, undefined, 0);

  return MetricsScrapeController as unknown as new (options: ResolvedMetricsOptions) => {
    scrape(request: Request): Promise<Response>;
  };
}
