import { expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory as ElysiaFactory } from "@aponiajs/platform-elysia";
import { createPlatformFactory } from "@aponiajs/platform-core";
import { h3Adapter } from "@aponiajs/platform-h3";
import { honoAdapter } from "@aponiajs/platform-hono";
import { toFetchHandler } from "@aponiajs/serverless";
import { MetricsModule, MetricsRegistry } from "../src/index.ts";

@Controller("hit")
class HitController {
  @Get(":id")
  read(): string {
    return "hit";
  }
}

const elysiaRegistry = new MetricsRegistry();
const honoRegistry = new MetricsRegistry();
const h3Registry = new MetricsRegistry();

@Module({
  imports: [MetricsModule.forRoot({ registry: elysiaRegistry, processMetrics: false })],
  controllers: [HitController],
})
class ElysiaModule {}

@Module({
  imports: [MetricsModule.forRoot({ registry: honoRegistry, processMetrics: false })],
  controllers: [HitController],
})
class HonoModule {}

@Module({
  imports: [MetricsModule.forRoot({ registry: h3Registry, processMetrics: false })],
  controllers: [HitController],
})
class H3Module {}

async function scrape(
  fetch: (request: Request) => Response | Promise<Response>,
): Promise<{ status: number; text: string; cacheControl: string | null }> {
  await fetch(new Request("http://localhost/hit/42"));
  await fetch(new Request("http://localhost/hit/43"));
  const response = await fetch(new Request("http://localhost/metrics"));
  return {
    status: response.status,
    text: await response.text(),
    cacheControl: response.headers.get("cache-control"),
  };
}

test("the same metrics registration answers identically on every platform", async () => {
  const elysia = await ElysiaFactory.create(ElysiaModule, { logger: false });
  const hono = await createPlatformFactory(honoAdapter()).create(HonoModule, { logger: false });
  const h3 = await createPlatformFactory(h3Adapter()).create(H3Module, { logger: false });

  try {
    const answers = {
      elysia: await scrape((request) => elysia.handle(request)),
      hono: await scrape((request) => hono.handle(request)),
      h3: await scrape((request) => h3.handle(request)),
      serverless: await scrape(toFetchHandler(hono)),
    };
    for (const observed of Object.values(answers)) {
      expect(observed.status).toBe(200);
      expect(observed.cacheControl).toBe("no-store");
      expect(observed.text).not.toContain('route="/hit/42"');
      expect(observed.text).not.toContain('route="/metrics"');
      expect(observed.text).not.toContain("process_uptime_seconds");
    }
    expect(answers.elysia.text).toContain(
      'http_requests_total{method="GET",route="/hit/:id",status="200"} 2',
    );
    expect(answers.hono.text).toContain(
      'http_requests_total{method="GET",route="/hit/:id",status="200"} 2',
    );
    expect(answers.h3.text).toContain(
      'http_requests_total{method="GET",route="/hit/:id",status="200"} 2',
    );
    // The Web Fetch adapter serves the Hono application, so its two requests add
    // to the registry the direct Hono requests already recorded.
    expect(answers.serverless.text).toContain(
      'http_requests_total{method="GET",route="/hit/:id",status="200"} 4',
    );
  } finally {
    await elysia.close();
    await hono.close();
    await h3.close();
  }
});

test("two applications keep separate registries and a closed boot records nothing", async () => {
  const first = new MetricsRegistry();
  const second = new MetricsRegistry();

  @Module({
    imports: [MetricsModule.forRoot({ registry: first, processMetrics: false })],
    controllers: [HitController],
  })
  class FirstModule {}

  @Module({
    imports: [MetricsModule.forRoot({ registry: second, processMetrics: false })],
    controllers: [HitController],
  })
  class SecondModule {}

  const one = await ElysiaFactory.create(FirstModule, { logger: false });
  await one.handle(new Request("http://localhost/hit/1"));
  await one.close();

  const two = await ElysiaFactory.create(SecondModule, { logger: false });
  try {
    await two.handle(new Request("http://localhost/hit/2"));
    expect(first.render()).toContain('status="200"} 1');
    expect(second.render()).toContain('status="200"} 1');
    expect(second.render()).toContain('route="/hit/:id"');
  } finally {
    await two.close();
  }
});
