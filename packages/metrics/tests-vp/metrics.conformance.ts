import {
  MetricsExceptionFilter,
  MetricsModule,
  MetricsRegistry,
  metricsContentType,
  metricsPlugin,
  type MetricsPluginOptions,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("exposes the documented metrics contract", () => {
  const options: MetricsPluginOptions = {
    path: "/internal/metrics",
    prefix: "app",
    processMetrics: false,
  };

  expect(options.path).toBe("/internal/metrics");
  expect(options.processMetrics).toBe(false);
  expect(metricsContentType).toContain("version=0.0.4");
});

test("renders a registry and builds the module and plugin", () => {
  const registry = new MetricsRegistry({ buckets: [0.1, 1] });
  registry.counter("jobs_total").inc({ state: "done" });
  registry.gauge("queue_depth").set(3);
  registry.histogram("latency_seconds").observe(0.05);

  const text = registry.render();

  expect(text).toContain("# TYPE jobs_total counter");
  expect(text).toContain('jobs_total{state="done"} 1');
  expect(text).toContain("# TYPE queue_depth gauge");
  expect(text).toContain('latency_seconds_bucket{le="0.1"} 1');

  let depth = 1;
  const collected = registry.gauge("collected_depth");
  registry.registerCollector(() => collected.set(depth));
  expect(registry.render()).toContain("collected_depth 1");
  depth = 2;
  expect(registry.render()).toContain("collected_depth 2");

  const module = MetricsModule.register({ registry, path: "/metrics" });
  expect(module.id).toBe("PluginModule[metrics]");
  expect(module.exports).toContain(MetricsRegistry);
  expect(module.exports).toContain(MetricsExceptionFilter);
  expect(metricsPlugin({ registry })).toBeDefined();
});
