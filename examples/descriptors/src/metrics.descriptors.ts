import { createToken, defineModule, provideClass, provideValue } from "@aponiajs/common";
import { defineElysiaController } from "@aponiajs/platform-elysia";

/**
 * The descriptor authoring layer. No decorators anywhere: `defineModule`,
 * `provide*`, and `defineElysiaController` build the frozen shape directly.
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

const metricsController = defineElysiaController(
  class MetricsController {
    constructor(readonly metricsService: MetricsService) {}
  },
  {
    inject: [MetricsService],
    path: "/metrics",
    registerRoutes: (application, controller) => {
      application.get("/metrics", () => controller.metricsService.record());
    },
  },
);

export const metricsModule = defineModule({
  id: "MetricsModule",
  controllers: [metricsController],
  providers: [
    provideValue(METRICS_NAMESPACE, "descriptors"),
    provideClass(MetricsService, [METRICS_NAMESPACE]),
  ],
});
