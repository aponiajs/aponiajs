import { expect, test } from "bun:test";
import { Body, Controller, Get, Module, Post, defineConfiguration } from "@aponiajs/common";
import { AponiaFactory as ElysiaFactory } from "@aponiajs/platform-elysia";
import { createPlatformFactory } from "@aponiajs/platform-core";
import { h3Adapter } from "@aponiajs/platform-h3";
import { honoAdapter } from "@aponiajs/platform-hono";
import { toFetchHandler } from "@aponiajs/serverless";
import { z } from "zod";
import { OpenApiModule } from "../src/index.ts";

const OpenApiConfig = defineConfiguration(
  z.object({ TITLE: z.string().min(1).default("Parity API") }).transform(({ TITLE }) => ({
    info: { title: TITLE, version: "1.0.0" },
  })),
  "openapi.parity",
);

@Controller("widgets")
class WidgetsController {
  @Get(":id")
  read(): { id: string } {
    return { id: "1" };
  }

  @Post("/")
  create(@Body() body: { name: string }): { name: string } {
    return body;
  }
}

function appModule(): new () => unknown {
  @Module({
    imports: [OpenApiModule.forRoot({ configuration: OpenApiConfig, source: {} })],
    controllers: [WidgetsController],
  })
  class AppModule {}

  return AppModule;
}

async function observe(
  fetch: (request: Request) => Response | Promise<Response>,
): Promise<{ title: string; paths: string[]; page: number; pageType: string | null }> {
  const document = await fetch(new Request("http://localhost/openapi/json"));
  const page = await fetch(new Request("http://localhost/openapi"));
  const body = (await document.json()) as {
    info: { title: string };
    paths: Record<string, unknown>;
  };
  return {
    title: body.info.title,
    paths: Object.keys(body.paths),
    page: page.status,
    pageType: page.headers.get("content-type"),
  };
}

test("the same OpenAPI registration serves the same document on every platform", async () => {
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
      expect(observed.title).toBe("Parity API");
      expect(observed.paths).toEqual(["/widgets/{id}", "/widgets"]);
      expect(observed.page).toBe(200);
      expect(observed.pageType).toContain("text/html");
    }
  } finally {
    await elysia.close();
    await hono.close();
    await h3.close();
  }
});
