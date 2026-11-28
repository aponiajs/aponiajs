import { describe, expect, it } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { MetricsModule, MetricsService, PROMETHEUS_CONTENT_TYPE } from "./index.ts";

describe("MetricsModule & MetricsService", () => {
  it("records HTTP request metrics and serves Prometheus text at /metrics", async () => {
    @Controller("items")
    class ItemsController {
      @Get()
      list(): { readonly ok: boolean } {
        return { ok: true };
      }
    }

    @Module({
      imports: [MetricsModule.forRoot({ prefix: "app_" })],
      controllers: [ItemsController],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const apiRes = await app.handle(new Request("http://localhost/items?page=1"));
      expect(apiRes.status).toBe(200);

      const metricsRes = await app.handle(new Request("http://localhost/metrics"));
      expect(metricsRes.status).toBe(200);
      expect(metricsRes.headers.get("content-type")).toBe(PROMETHEUS_CONTENT_TYPE);
      const body = await metricsRes.text();
      expect(body).toContain("app_process_resident_memory_bytes");
      expect(body).toContain('app_http_requests_total{method="GET",route="/items",status="200"} 1');
      expect(body).toContain(
        'app_http_request_duration_seconds_count{method="GET",route="/items",status="200"} 1',
      );
    } finally {
      await app.close();
    }
  });

  it("supports custom counters, gauges, histograms, and cardinality limits", () => {
    const service = new MetricsService({
      path: "/metrics",
      exposeEndpoint: false,
      collectDefaultMetrics: false,
      collectHttpMetrics: false,
      httpBuckets: [0.1, 1],
      maxLabelCombinations: 2,
      prefix: "",
      authorize: undefined,
    });

    const jobs = service.counter({ name: "jobs_total", help: 'Jobs "processed"\nline' });
    jobs.inc({ queue: "a" });
    jobs.inc({ queue: "a" }, 2);
    jobs.inc({ queue: "b" });
    jobs.inc({ queue: "c" }); // exceeds maxLabelCombinations=2

    const active = service.gauge({ name: "active_jobs", help: "Active jobs" });
    active.set(5);
    active.inc(undefined, 2);
    active.dec(undefined, 3);

    const latency = service.histogram({ name: "job_seconds", help: "Latency", buckets: [0.5, 1] });
    latency.observe(0.25);
    latency.observe(Number.NaN);

    // Re-retrieving existing metrics and hitting maxLabelCombinations on gauge/histogram
    expect(service.counter({ name: "jobs_total", help: "x" })).toBeDefined();
    expect(service.gauge({ name: "active_jobs", help: "x" })).toBeDefined();
    expect(service.histogram({ name: "job_seconds", help: "x" })).toBeDefined();
    active.set(1, { node: "a" });
    active.set(2, { node: "b" }); // hits maxLabelCombinations=2 (empty + node=a)
    latency.observe(0.1, { route: "/a" });
    latency.observe(0.1, { route: "/b" }); // hits maxLabelCombinations=2
    service.recordHttpRequest("GET", "/skip", 200, 0.01); // collectHttpMetrics: false

    const text = service.render();
    expect(text).toContain('jobs_total{queue="a"} 3');
    expect(text).toContain('jobs_total{queue="b"} 1');
    expect(text).not.toContain('queue="c"');
    expect(text).toContain("active_jobs 4");
    expect(text).toContain('job_seconds_bucket{le="0.5"} 1');
    expect(text).toContain('job_seconds_bucket{le="+Inf"} 1');

    expect(() => service.counter({ name: "active_jobs", help: "x" })).toThrow();
    expect(() => service.gauge({ name: "jobs_total", help: "x" })).toThrow();
    expect(() => service.histogram({ name: "jobs_total", help: "x" })).toThrow();
    expect(() => jobs.inc({}, -1)).toThrow();
    expect(() => active.set(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => active.inc({}, Number.NaN)).toThrow();
    expect(() => active.dec({}, Number.NaN)).toThrow();

    service.reset();
    expect(service.render()).toBe("\n");
  });

  it("supports forRootAsync, endpoint authorization, and rejects invalid options", async () => {
    expect(() => MetricsModule.forRoot({ path: "metrics" })).toThrow();
    expect(() => MetricsModule.forRoot({ maxLabelCombinations: 0 })).toThrow();
    expect(() => MetricsModule.forRoot({ httpBuckets: [-1] })).toThrow();

    @Controller("ping")
    class PingController {
      @Get()
      ping(): string {
        return "pong";
      }
    }

    @Module({
      imports: [
        MetricsModule.forRootAsync({
          useFactory: async () => ({
            path: "/prom",
            collectDefaultMetrics: false,
            authorize: (req) => req.headers.get("authorization") === "Bearer secret",
          }),
        }),
      ],
      controllers: [PingController],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const denied = await app.handle(new Request("http://localhost/prom"));
      expect(denied.status).toBe(403);

      const allowed = await app.handle(
        new Request("http://localhost/prom", {
          headers: { authorization: "Bearer secret" },
        }),
      );
      expect(allowed.status).toBe(200);
    } finally {
      await app.close();
    }

    @Module({
      imports: [
        MetricsModule.forRoot({
          exposeEndpoint: false,
          collectHttpMetrics: false,
          collectDefaultMetrics: false,
        }),
      ],
      controllers: [PingController],
    })
    class DisabledModule {}

    const disabledApp = await AponiaFactory.create(DisabledModule, { logger: false });
    try {
      const res = await disabledApp.handle(new Request("http://localhost/ping"));
      expect(res.status).toBe(200);
      expect(disabledApp.get(MetricsService).render()).toBe("\n");
    } finally {
      await disabledApp.close();
    }
  });
});
