import { expect, test } from "bun:test";
import { Controller, Get, Module, defineConfiguration } from "@aponiajs/common";
import { AponiaFactory as ElysiaFactory } from "@aponiajs/platform-elysia";
import { createPlatformFactory } from "@aponiajs/platform-core";
import { h3Adapter } from "@aponiajs/platform-h3";
import { honoAdapter } from "@aponiajs/platform-hono";
import { toFetchHandler } from "@aponiajs/serverless";
import { z } from "zod";
import { OpentelemetryModule } from "../src/index.ts";

const OpentelemetryConfig = defineConfiguration(
  z.object({}).transform(() => ({ serviceName: "aponia-parity" })),
  "opentelemetry.parity",
);

@Controller("traced")
class TracedController {
  @Get("/")
  read(): string {
    return "ok";
  }
}

function appModule(): new () => unknown {
  @Module({
    imports: [OpentelemetryModule.forRoot({ configuration: OpentelemetryConfig, source: {} })],
    controllers: [TracedController],
  })
  class AppModule {}

  return AppModule;
}

async function observe(
  fetch: (request: Request) => Response | Promise<Response>,
): Promise<{ status: number; body: string }> {
  const response = await fetch(new Request("http://localhost/traced"));
  return { status: response.status, body: await response.text() };
}

test("the same tracing registration boots and answers on every platform", async () => {
  const elysia = await ElysiaFactory.create(appModule(), { logger: false });
  const hono = await createPlatformFactory(honoAdapter()).create(appModule(), { logger: false });
  const h3 = await createPlatformFactory(h3Adapter()).create(appModule(), { logger: false });

  try {
    const answers = {
      elysia: await observe((request) => elysia.handle(request)),
      hono: await observe((request) => hono.handle(request)),
      h3: await observe((request) => h3.handle(request)),
      serverless: await observe(toFetchHandler(hono)),
    };
    for (const observed of Object.values(answers)) {
      expect(observed).toEqual({ status: 200, body: "ok" });
    }
  } finally {
    await elysia.close();
    await hono.close();
    await h3.close();
  }
});
