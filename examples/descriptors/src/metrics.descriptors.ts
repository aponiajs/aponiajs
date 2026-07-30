import { createToken, defineModule, provideClass, provideValue } from "@aponiajs/common";
import { elysiaController, httpErrors } from "@aponiajs/platform-elysia";

/**
 * The descriptor authoring layer. No decorators anywhere: `defineModule`,
 * `provide*`, and `elysiaController` build the frozen shape directly.
 */
const METRICS_NAMESPACE = createToken<string>("METRICS_NAMESPACE");

export class MetricsService {
  #hits = 0;

  constructor(private readonly namespace: string) {}

  record(): { namespace: string; hits: number } {
    this.#hits += 1;
    return { namespace: this.namespace, hits: this.#hits };
  }
}

const metricsController = elysiaController(
  class MetricsController {
    constructor(readonly metricsService: MetricsService) {}
  },
  [MetricsService],
  (application, controller) =>
    application
      .get("/metrics", () => controller.metricsService.record())
      .get("/metrics/missing", () => {
        throw httpErrors.notFound("The requested metric does not exist.", {
          code: "METRIC_NOT_FOUND",
        });
      }),
);

export const metricsModule = defineModule({
  id: "MetricsModule",
  controllers: [metricsController],
  providers: [
    provideValue(METRICS_NAMESPACE, "descriptors"),
    provideClass(MetricsService, [METRICS_NAMESPACE]),
  ],
});
