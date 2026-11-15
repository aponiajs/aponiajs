import { afterEach, describe, expect, test } from "bun:test";
import { Controller, Get, HttpStatus, Module, Post } from "@aponiajs/common";
import {
  AponiaFactory,
  httpErrors,
  type AponiaApplication,
  type ResponseStatus,
} from "@aponiajs/platform-elysia";
import { MetricsExceptionFilter, MetricsModule, MetricsRegistry } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

@Controller("widgets")
class WidgetsController {
  @Get()
  list(): string {
    return "list";
  }

  @Get(":id")
  one(): string {
    return "one";
  }

  @Post()
  create(@HttpStatus() status: ResponseStatus): unknown {
    return status(201, "created");
  }

  @Get("missing")
  missing(): string {
    throw httpErrors.notFound("No such widget.");
  }

  @Get("boom")
  boom(): string {
    throw new Error("boom");
  }

  @Get(":id/fail")
  failOne(): string {
    throw new Error("fail one");
  }
}

describe("metrics plugin", () => {
  test("serves a scrape endpoint and instruments every route", async () => {
    const registry = new MetricsRegistry();

    @Module({
      imports: [MetricsModule.register({ registry })],
      controllers: [WidgetsController],
    })
    class InstrumentedModule {}

    application = await AponiaFactory.create(InstrumentedModule, {
      logger: false,
      filters: [MetricsExceptionFilter],
    });

    expect((await application.handle(new Request("http://localhost/widgets"))).status).toBe(200);
    expect((await application.handle(new Request("http://localhost/widgets/42"))).status).toBe(200);
    expect(
      (await application.handle(new Request("http://localhost/widgets", { method: "POST" })))
        .status,
    ).toBe(201);
    expect((await application.handle(new Request("http://localhost/widgets/missing"))).status).toBe(
      404,
    );
    expect((await application.handle(new Request("http://localhost/widgets/boom"))).status).toBe(
      500,
    );
    expect((await application.handle(new Request("http://localhost/widgets/42/fail"))).status).toBe(
      500,
    );

    const response = await application.handle(new Request("http://localhost/metrics"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain("# TYPE http_requests_total counter");
    expect(body).toContain('http_requests_total{method="GET",route="/widgets",status="200"} 1');
    expect(body).toContain('http_requests_total{method="GET",route="/widgets/:id",status="200"} 1');
    expect(body).toContain('http_requests_total{method="POST",route="/widgets",status="201"} 1');
    expect(body).toContain(
      'http_requests_total{method="GET",route="/widgets/missing",status="404"} 1',
    );
    expect(body).toContain(
      'http_requests_total{method="GET",route="/widgets/boom",status="500"} 1',
    );
    expect(body).toContain(
      'http_requests_total{method="GET",route="/widgets/:id/fail",status="500"} 1',
    );
    expect(body).not.toContain('route="/widgets/42/fail"');
    expect(body).toContain("# TYPE http_request_duration_seconds histogram");
    expect(body).toContain("# TYPE process_uptime_seconds gauge");
    expect(body).toContain("# TYPE process_resident_memory_bytes gauge");
    expect(body).not.toContain('route="/metrics"');
  });

  test("omits process metrics when the registration disables them", async () => {
    @Module({
      imports: [MetricsModule.register({ processMetrics: false })],
      controllers: [WidgetsController],
    })
    class PlainModule {}

    application = await AponiaFactory.create(PlainModule, { logger: false });
    const body = await (await application.handle(new Request("http://localhost/metrics"))).text();

    expect(body).not.toContain("process_uptime_seconds");
    expect(body).toContain("# TYPE http_requests_total counter");
  });

  test("serves a custom path and skips the routes an application excludes", async () => {
    @Module({
      imports: [MetricsModule.register({ path: "internal/metrics", exclude: ["/widgets/boom"] })],
      controllers: [WidgetsController],
    })
    class CustomModule {}

    application = await AponiaFactory.create(CustomModule, { logger: false });
    await application.handle(new Request("http://localhost/widgets/boom"));
    await application.handle(new Request("http://localhost/widgets"));

    const body = await (
      await application.handle(new Request("http://localhost/internal/metrics"))
    ).text();

    expect(body).toContain('route="/widgets"');
    expect(body).not.toContain('route="/widgets/boom"');
  });

  test("records into a registry the application supplies", async () => {
    const registry = new MetricsRegistry({ prefix: "app" });

    @Module({
      imports: [MetricsModule.register({ registry, path: "/stats" })],
      controllers: [WidgetsController],
    })
    class RegistryModule {}

    application = await AponiaFactory.create(RegistryModule, { logger: false });
    await application.handle(new Request("http://localhost/widgets"));
    const body = await (await application.handle(new Request("http://localhost/stats"))).text();

    expect(body).toContain("# TYPE app_http_requests_total counter");
    expect(registry.render()).toContain("app_http_requests_total");
  });
});
