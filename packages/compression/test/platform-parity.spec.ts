import { expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory as ElysiaFactory } from "@aponiajs/platform-elysia";

import { AponiaFactory as H3AponiaFactory } from "@aponiajs/platform-h3";
import { AponiaFactory as HonoAponiaFactory } from "@aponiajs/platform-hono";
import { toFetchHandler } from "@aponiajs/serverless";
import { gunzipSync } from "node:zlib";
import { CompressionModule } from "../src/index.ts";

const body = "a".repeat(4_000);

@Controller("large")
class LargeController {
  @Get()
  read(): string {
    return body;
  }
}

@Module({
  imports: [CompressionModule.forRoot({ thresholdBytes: 100 })],
  controllers: [LargeController],
})
class AppModule {}

interface Answer {
  readonly status: number;
  readonly encoding: string | null;
  readonly body: string;
}

async function answer(fetch: (request: Request) => Response | Promise<Response>): Promise<Answer> {
  const response = await fetch(
    new Request("http://localhost/large", { headers: { "accept-encoding": "gzip" } }),
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    encoding: response.headers.get("content-encoding"),
    body:
      response.headers.get("content-encoding") === "gzip"
        ? new TextDecoder().decode(gunzipSync(bytes))
        : new TextDecoder().decode(bytes),
  };
}

test("the same compression registration answers identically on every platform", async () => {
  const elysia = await ElysiaFactory.create(AppModule, { logger: false });
  const hono = await HonoAponiaFactory.create(AppModule, { logger: false });
  const h3 = await H3AponiaFactory.create(AppModule, { logger: false });

  try {
    const answers = {
      elysia: await answer((request) => elysia.handle(request)),
      hono: await answer((request) => hono.handle(request)),
      h3: await answer((request) => h3.handle(request)),
      serverless: await answer(toFetchHandler(hono)),
    };
    for (const observed of Object.values(answers)) {
      expect(observed.status).toBe(200);
      expect(observed.encoding).toBe("gzip");
      expect(observed.body).toBe(body);
    }
  } finally {
    await elysia.close();
    await hono.close();
    await h3.close();
  }
});

test("a client that states no accepted encoding gets the identity body everywhere", async () => {
  const elysia = await ElysiaFactory.create(AppModule, { logger: false });
  const hono = await HonoAponiaFactory.create(AppModule, { logger: false });
  const h3 = await H3AponiaFactory.create(AppModule, { logger: false });

  try {
    for (const application of [elysia, hono, h3]) {
      const response = await application.handle(new Request("http://localhost/large"));
      expect(response.headers.get("content-encoding")).toBeNull();
      expect(await response.text()).toBe(body);
    }
  } finally {
    await elysia.close();
    await hono.close();
    await h3.close();
  }
});
