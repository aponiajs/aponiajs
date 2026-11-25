import { expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { MetricsModule } from "./index.ts";

@Controller("ok")
class OkController {
  @Get()
  read(): Response {
    return new Response("ok", { status: 201 });
  }
}

@Controller("fail")
class FailController {
  @Get()
  read(): never {
    throw Object.assign(new Error("boom"), { statusCode: 418 });
  }
}

@Controller("ignored")
class IgnoredController {
  @Get()
  read(): string {
    return "ignored";
  }
}

test("resolves the path, prefix, caps, buckets, process metrics, and exclusions", async () => {
  @Module({
    imports: [
      MetricsModule.forRoot({
        path: "custom/",
        prefix: "app",
        maxSeriesPerMetric: 5,
        buckets: [0.01, 0.1],
        processMetrics: false,
        exclude: ["/ignored"],
      }),
    ],
    controllers: [OkController, FailController, IgnoredController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    expect((await application.handle(new Request("http://localhost/ok"))).status).toBe(201);
    expect((await application.handle(new Request("http://localhost/fail"))).status).toBe(500);
    expect((await application.handle(new Request("http://localhost/ignored"))).status).toBe(200);

    const response = await application.handle(new Request("http://localhost/custom"));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("app_http_requests_total");
    expect(text).toContain("app_http_request_duration_seconds");
    expect(text).not.toContain("process_uptime_seconds");
    expect(text).toContain('route="/ok"');
    expect(text).not.toContain('route="/ignored"');
  } finally {
    await application.close();
  }
});

test("an authorize hook protects the scrape endpoint before rendering", async () => {
  @Module({
    imports: [
      MetricsModule.forRoot({
        path: "/metrics",
        processMetrics: false,
        authorize: (request) => request.headers.get("x-scrape") === "yes",
      }),
    ],
    controllers: [OkController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });

  try {
    const denied = await application.handle(new Request("http://localhost/metrics"));
    expect(denied.status).toBe(401);
    expect(await denied.text()).toBe("");
    expect(denied.headers.get("cache-control")).toBe("no-store");

    const allowed = await application.handle(
      new Request("http://localhost/metrics", { headers: { "x-scrape": "yes" } }),
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain("http_requests_total");
  } finally {
    await application.close();
  }
});
