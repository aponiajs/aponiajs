import { defineModule, provideClass, provideValue, createToken } from "@aponiajs/common";
import { defineElysiaController } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";

/**
 * Use case: the descriptor authoring layer. No decorators anywhere — this
 * module is the frozen shape the runtime consumes, written by hand.
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
    buildPlugin: (controller) =>
      new Elysia({ name: "metrics-controller" }).get("/metrics", () =>
        controller.metricsService.record(),
      ),
  },
);

export const metricsModule = defineModule({
  id: "MetricsModule",
  controllers: [metricsController],
  providers: [
    provideValue(METRICS_NAMESPACE, "feature-tour"),
    provideClass(MetricsService, [METRICS_NAMESPACE]),
  ],
});
