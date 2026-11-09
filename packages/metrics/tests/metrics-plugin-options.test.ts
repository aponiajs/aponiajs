import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { metricsPlugin } from "../src/index.ts";

test("builds a registry from plugin options and records successes and failures", async () => {
  const app = new Elysia()
    .use(
      metricsPlugin({
        path: "custom/",
        prefix: "app",
        maxSeriesPerMetric: 5,
        buckets: [0.01, 0.1],
        processMetrics: false,
        exclude: ["ignored"],
      }),
    )
    .get("/ok", () => new Response("ok", { status: 201 }))
    .get("/fail", () => {
      throw Object.assign(new Error("boom"), { statusCode: 418 });
    })
    .get("/ignored", () => "ignored");

  expect((await app.handle(new Request("http://localhost/ok"))).status).toBe(201);
  expect((await app.handle(new Request("http://localhost/fail"))).status).toBe(500);
  expect((await app.handle(new Request("http://localhost/ignored"))).status).toBe(200);

  const scrape = await app.handle(new Request("http://localhost/custom/"));
  const text = await scrape.text();
  expect(text).toContain("app_http_requests_total");
  expect(text).toContain("app_http_request_duration_seconds");
  expect(text).not.toContain("process_uptime_seconds");
});
