import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { MetricsModule, MetricsService, MODULE_OPTIONS_TOKEN } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("registers MetricsModule and exposes MetricsService", async () => {
  @Controller("health")
  class HealthController {
    @Get()
    check(): string {
      return "ok";
    }
  }

  @Module({
    imports: [MetricsModule.forRoot({ collectDefaultMetrics: false })],
    controllers: [HealthController],
  })
  class AppModule {}

  const def = MetricsModule.forRoot();
  expect(def.exports).toContain(MODULE_OPTIONS_TOKEN);

  const app = await AponiaFactory.create(AppModule, { logger: false });
  try {
    await app.handle(new Request("http://localhost/health"));
    const metrics = app.get(MetricsService);
    expect(metrics.render()).toContain(
      'http_requests_total{method="GET",route="/health",status="200"} 1',
    );
  } finally {
    await app.close();
  }
});
