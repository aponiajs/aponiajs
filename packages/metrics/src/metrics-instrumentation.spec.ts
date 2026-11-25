import { expect, test } from "bun:test";
import type { ExecutionContext, RouteContext } from "@aponiajs/common";
import { MetricsExceptionFilter } from "./metrics.filter.ts";
import { createMetricsInstrumentation } from "./metrics-instrumentation.ts";
import { MetricsRegistry } from "./registry/metrics.registry.ts";

/**
 * The two halves an application composes itself: the neutral instrumentation
 * hook, and the exported exception filter an application may add beside it.
 * The plugin cases boot the registration; these assert what each hook records
 * when it is called with the values a boundary hands it.
 */

function requestFor(url: string, method = "GET"): Request {
  return new Request(url, { method });
}

function hostFor(context: {
  readonly request: Request;
  readonly route?: unknown;
  readonly path?: unknown;
}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => context as unknown as RouteContext }),
  } as unknown as ExecutionContext;
}

test("builds its own registry from the prefix, cap, and buckets it is given", () => {
  const { registry, hook } = createMetricsInstrumentation({
    prefix: "app",
    maxSeriesPerMetric: 1,
    buckets: [0.1, 0.5],
    processMetrics: false,
  });

  const first = requestFor("http://localhost/a");
  const second = requestFor("http://localhost/b");
  void hook.onRequest!(first);
  void hook.onResponse!(first, new Response("a"));
  void hook.onRequest!(second);
  void hook.onResponse!(second, new Response("b"));

  const rendered = registry.render();
  expect(rendered).toContain("# TYPE app_http_requests_total counter");
  expect(rendered).toContain('app_http_requests_total{method="GET",route="/a",status="200"} 1');
  // One label set past the cap is dropped rather than growing the registry.
  expect(rendered).not.toContain('route="/b"');
  expect(rendered).toContain(
    'app_http_request_duration_seconds_bucket{method="GET",route="/a",le="0.1"}',
  );
});

test("a request no route matched and no URL could parse records the unmatched label", () => {
  const { registry, hook } = createMetricsInstrumentation({ processMetrics: false });
  const request = requestFor("http://localhost/x");
  Object.defineProperty(request, "url", { value: "not a url" });

  void hook.onRequest!(request);
  void hook.onResponse!(request, new Response("ok"));

  expect(registry.render()).toContain(
    'http_requests_total{method="GET",route="unmatched",status="200"} 1',
  );
});

test("one request is recorded once however many boundaries report it", () => {
  const { registry, hook } = createMetricsInstrumentation({ processMetrics: false });
  const request = requestFor("http://localhost/once");

  void hook.onRequest!(request);
  void hook.onResponse!(request, new Response("ok"));
  void hook.onError!(request, new Error("reported twice"));

  expect(registry.render()).toContain(
    'http_requests_total{method="GET",route="/once",status="200"} 1',
  );
});

test("a failed request before any answer is recorded with its exception's status", () => {
  const { registry, hook } = createMetricsInstrumentation({ processMetrics: false });
  const withStatus = requestFor("http://localhost/status");
  const withStatusCode = requestFor("http://localhost/status-code");
  const unknown = requestFor("http://localhost/unknown");

  void hook.onRequest!(withStatus);
  void hook.onError!(withStatus, { status: 418 });
  void hook.onRequest!(withStatusCode);
  void hook.onError!(withStatusCode, Object.assign(new Error("boom"), { statusCode: 503 }));
  void hook.onRequest!(unknown);
  void hook.onError!(unknown, "not an error");

  const rendered = registry.render();
  expect(rendered).toContain('route="/status",status="418"');
  expect(rendered).toContain('route="/status-code",status="503"');
  expect(rendered).toContain('route="/unknown",status="500"');
});

test("the exception filter records the failure and declines it", () => {
  const registry = new MetricsRegistry();
  const filter = new MetricsExceptionFilter(registry);
  const request = requestFor("http://localhost/users/42");

  const result = filter.catch(new Error("boom"), hostFor({ request, route: "/users/:id" }));

  expect(result).toBeUndefined();
  expect(registry.render()).toContain(
    'http_requests_total{method="GET",route="/users/:id",status="500"} 1',
  );
});

test("the exception filter prefers the route over the path and the status the exception states", () => {
  const registry = new MetricsRegistry();
  const filter = new MetricsExceptionFilter(registry);

  filter.catch(
    { status: 422 },
    hostFor({ request: requestFor("http://localhost/users", "POST"), route: "/users" }),
  );
  filter.catch(
    { statusCode: 409 },
    hostFor({ request: requestFor("http://localhost/users/1"), route: "", path: "/users/1" }),
  );
  filter.catch({ status: 500 }, hostFor({ request: requestFor("http://localhost/other") }));

  const rendered = registry.render();
  expect(rendered).toContain('method="POST",route="/users",status="422"');
  expect(rendered).toContain('route="/users/1",status="409"');
  expect(rendered).toContain('method="GET",route="unmatched",status="500"');
});

test("a histogram observation past the series cap is dropped", () => {
  const registry = new MetricsRegistry({ maxSeriesPerMetric: 1 });
  const duration = registry.histogram("duration_seconds", { help: "duration" });

  duration.observe(0.2, { route: "/a" });
  duration.observe(0.3, { route: "/b" });

  const rendered = registry.render();
  expect(rendered).toContain('route="/a"');
  expect(rendered).not.toContain('route="/b"');
});
