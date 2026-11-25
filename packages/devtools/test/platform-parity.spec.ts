import { expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory as ElysiaFactory } from "@aponiajs/platform-elysia";
import { createPlatformFactory } from "@aponiajs/platform-core";
import { h3Adapter } from "@aponiajs/platform-h3";
import { honoAdapter } from "@aponiajs/platform-hono";
import { toFetchHandler } from "@aponiajs/serverless";
import { DevtoolsModule, devtoolsPathPrefix } from "../src/index.ts";

@Controller("greet")
class GreetController {
  @Get()
  read(): string {
    return "hello";
  }
}

@Module({
  imports: [DevtoolsModule.forRoot({ enabled: true })],
  controllers: [GreetController],
})
class ElysiaModule {}

@Module({
  imports: [DevtoolsModule.forRoot({ enabled: true })],
  controllers: [GreetController],
})
class HonoModule {}

@Module({
  imports: [DevtoolsModule.forRoot({ enabled: true })],
  controllers: [GreetController],
})
class H3Module {}

interface Answer {
  readonly meta: number;
  readonly contract: number;
  readonly routes: number;
  readonly paths: readonly string[];
  readonly page: number;
  readonly pageType: string | null;
  readonly missing: number;
}

async function observe(fetch: (request: Request) => Response | Promise<Response>): Promise<Answer> {
  const metaResponse = await fetch(new Request(`http://localhost${devtoolsPathPrefix}/meta`));
  const meta = (await metaResponse.json()) as { contract: number };
  const routesResponse = await fetch(new Request(`http://localhost${devtoolsPathPrefix}/routes`));
  const routes = (await routesResponse.json()) as {
    routes: { path: string }[];
  };
  const page = await fetch(new Request(`http://localhost${devtoolsPathPrefix}`));
  const missing = await fetch(new Request(`http://localhost${devtoolsPathPrefix}/missing`));
  return {
    meta: metaResponse.status,
    contract: meta.contract,
    routes: routesResponse.status,
    paths: routes.routes.map((route) => route.path),
    page: page.status,
    pageType: page.headers.get("content-type"),
    missing: missing.status,
  };
}

test("the same devtools registration answers identically on every platform", async () => {
  const elysia = await ElysiaFactory.create(ElysiaModule, { logger: false });
  const hono = await createPlatformFactory(honoAdapter()).create(HonoModule, { logger: false });
  const h3 = await createPlatformFactory(h3Adapter()).create(H3Module, { logger: false });

  try {
    const answers = {
      elysia: await observe((request) => elysia.handle(request)),
      hono: await observe((request) => hono.handle(request)),
      h3: await observe((request) => h3.handle(request)),
      serverless: await observe(toFetchHandler(hono)),
    };
    for (const observed of Object.values(answers)) {
      expect(observed.meta).toBe(200);
      expect(observed.contract).toBe(4);
      expect(observed.routes).toBe(200);
      expect(observed.paths).toContain("/greet");
      expect(observed.page).toBe(200);
      expect(observed.pageType).toContain("text/html");
      expect(observed.missing).toBe(404);
    }
  } finally {
    await elysia.close();
    await hono.close();
    await h3.close();
  }
});
